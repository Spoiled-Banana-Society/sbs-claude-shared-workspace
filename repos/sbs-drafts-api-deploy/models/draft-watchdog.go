package models

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"google.golang.org/api/iterator"
)

// ------------------------------------------------------------------
// Stuck-draft watchdog.
//
// A draft advances only when a pick is processed, and every processed pick
// schedules the NEXT pick's auto-draft Cloud Task. When a mid-pick failure
// (2026-06-10 draft-1381 and 2026-07-15 draft-156: Firestore
// DeadlineExceeded) kills the request after some state writes landed but
// before the next task was scheduled, the draft is left with a dead pick
// clock and nothing that will ever advance it.
//
// The watchdog sweep runs every minute. For any recent fast draft whose pick
// clock has been dead for watchdogGraceSeconds+, it rebuilds BOTH state docs
// (Firestore drafts/{id}/state/info and RTDB realTimeDraftInfo) from the pick
// summary — the append-only record of what actually happened — re-asserts the
// last pick's idempotent writes in case one was lost, gives the on-clock user
// a fresh full pick window, and schedules the standard auto-draft task. From
// there the normal per-pick machinery takes over. Every step is idempotent
// and re-runnable, so a sweep that itself fails mid-repair is simply finished
// by a later sweep.
//
// Fast drafts only (per Richard 2026-07-15); slow drafts are never touched.
// ------------------------------------------------------------------

const (
	// Seconds past PickEndTime before a draft counts as stuck. Generous vs
	// the in-request retry budget (3×2s) and Cloud Tasks redelivery backoff,
	// so the watchdog never races a pick that is still being processed.
	watchdogGraceSeconds = 45
	// Dead longer than this = pre-watchdog wreckage (abandoned experiments,
	// old seasons). Reviving a days-old draft would mint cards and pollute
	// ADP, so those are logged and left alone.
	watchdogZombieSeconds = 48 * 60 * 60
	// Only this season's fast drafts are eligible.
	watchdogFastDraftPrefix = "2026-fast-draft-"
	// Drafts fill sequentially and run ~75 minutes, so anything active is
	// always among the most recent few; 30 is a wide margin.
	watchdogRecentWindow = 30
)

// Drafts the watchdog must never touch, even when stuck. Empty since
// 2026-07-20: the BBB #162 (fast-156) entry was removed once that draft was
// hand-closed + healed (Richard's 7/19 note — "delete the inert exclusion").
var watchdogExcludedDrafts = map[string]string{}

type WatchdogDraftReport struct {
	DraftId    string `json:"draftId"`
	Status     string `json:"status"`
	Detail     string `json:"detail,omitempty"`
	PicksMade  int    `json:"picksMade,omitempty"`
	NextPick   int    `json:"nextPick,omitempty"`
	NewDrafter string `json:"newDrafter,omitempty"`
	DeadForSec int64  `json:"deadForSec,omitempty"`
	// Healed marks a repair that had to resolve a summary/playerState SPLIT
	// before it could advance. Surfaced so a self-heal is visible in the sweep
	// report rather than looking like an ordinary repair.
	Healed bool `json:"healed,omitempty"`
}

type WatchdogSweepReport struct {
	SweptAtUnix       int64                 `json:"sweptAtUnix"`
	DryRun            bool                  `json:"dryRun"`
	CandidatesChecked int                   `json:"candidatesChecked"`
	HealthyOrIdle     int                   `json:"healthyOrIdle"`
	Drafts            []WatchdogDraftReport `json:"drafts"`
	Error             string                `json:"error,omitempty"`
}

// WatchdogSweep checks the most recent fast drafts and repairs any with a
// dead pick clock. With dryRun it reports what it WOULD do without writing.
func WatchdogSweep(dryRun bool) *WatchdogSweepReport {
	now := time.Now().Unix()
	report := &WatchdogSweepReport{SweptAtUnix: now, DryRun: dryRun, Drafts: []WatchdogDraftReport{}}

	ids, err := listRecentFastDraftIds(watchdogRecentWindow)
	if err != nil {
		report.Error = fmt.Sprintf("listing drafts failed: %v", err)
		logCriticalDraftError("watchdog_list_failed", "-", 0, err)
		return report
	}
	report.CandidatesChecked = len(ids)

	for _, draftId := range ids {
		row := watchdogCheckDraft(draftId, now, dryRun)
		if row == nil {
			report.HealthyOrIdle++
			continue
		}
		report.Drafts = append(report.Drafts, *row)
	}
	return report
}

// listRecentFastDraftIds returns the newest `limit` fast-draft ids by numeric
// suffix. It lists document REFS only (no doc contents), so the scan is cheap
// no matter how large the drafts collection is.
func listRecentFastDraftIds(limit int) ([]string, error) {
	iter := utils.Db.Client.Collection("drafts").DocumentRefs(context.Background())
	type numbered struct {
		id string
		n  int
	}
	var found []numbered
	for {
		ref, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		if !strings.HasPrefix(ref.ID, watchdogFastDraftPrefix) {
			continue
		}
		n, convErr := strconv.Atoi(strings.TrimPrefix(ref.ID, watchdogFastDraftPrefix))
		if convErr != nil {
			continue
		}
		found = append(found, numbered{id: ref.ID, n: n})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].n > found[j].n })
	if len(found) > limit {
		found = found[:limit]
	}
	ids := make([]string, 0, len(found))
	for _, f := range found {
		ids = append(ids, f.id)
	}
	return ids, nil
}

// watchdogCheckDraft returns nil for drafts that need no attention, or a
// report row describing what was done / would be done / why it was skipped.
func watchdogCheckDraft(draftId string, now int64, dryRun bool) *WatchdogDraftReport {
	rt, err := GetRealTimeDraftInfoForDraft(draftId)
	if err != nil {
		return &WatchdogDraftReport{DraftId: draftId, Status: "error_read_rtdb", Detail: err.Error()}
	}
	// Not started (no RTDB node yet / still filling / countdown running), or
	// already finished: nothing to guard.
	if rt.PickEndTime == 0 || rt.DraftStartTime == 0 || now < rt.DraftStartTime {
		return nil
	}
	if rt.IsDraftComplete || rt.IsDraftClosed {
		return nil
	}
	deadFor := now - rt.PickEndTime
	if deadFor < watchdogGraceSeconds {
		return nil // clock alive or within grace — healthy
	}
	if reason, excluded := watchdogExcludedDrafts[draftId]; excluded {
		return &WatchdogDraftReport{DraftId: draftId, Status: "excluded_skipped", Detail: reason, DeadForSec: deadFor}
	}
	if deadFor > watchdogZombieSeconds {
		fmt.Printf(`{"severity":"WARNING","event":"watchdog_zombie_skipped","draftId":"%s","deadForSec":%d}`+"\n", draftId, deadFor)
		return &WatchdogDraftReport{DraftId: draftId, Status: "zombie_skipped", DeadForSec: deadFor}
	}
	return watchdogRepairDraft(draftId, rt, deadFor, dryRun)
}

// watchdogRepairDraft rebuilds the draft's state from the pick summary and
// re-arms the auto-draft task chain. The summary is the source of truth: it
// is written BEFORE the state advance in ProcessNewPick, so
// picksMade = (filled summary slots) is always >= what either state doc says.
func watchdogRepairDraft(draftId string, rt *RealTimeDraftInfo, deadFor int64, dryRun bool) *WatchdogDraftReport {
	row := &WatchdogDraftReport{DraftId: draftId, DeadForSec: deadFor}

	summary, err := ReturnDraftSummaryForDraft(draftId)
	if err != nil {
		row.Status = "error_read_summary"
		row.Detail = err.Error()
		return row
	}
	if len(summary.Summary) != 150 {
		row.Status = "bad_summary_length"
		row.Detail = fmt.Sprintf("expected 150 slots, got %d", len(summary.Summary))
		logCriticalDraftError("watchdog_bad_summary", draftId, 0, fmt.Errorf("%s", row.Detail))
		return row
	}

	// Count picks and verify they are contiguous from slot 1. A hole means a
	// state shape we don't understand — leave it for a human.
	picksMade := 0
	for i := 0; i < 150; i++ {
		if summary.Summary[i].PlayerInfo.PlayerId == "" {
			picksMade = i
			for j := i + 1; j < 150; j++ {
				if summary.Summary[j].PlayerInfo.PlayerId != "" {
					row.Status = "summary_hole"
					row.Detail = fmt.Sprintf("slot %d empty but slot %d filled", i+1, j+1)
					logCriticalDraftError("watchdog_summary_hole", draftId, i+1, fmt.Errorf("%s", row.Detail))
					return row
				}
			}
			break
		}
		picksMade = i + 1
	}
	row.PicksMade = picksMade

	draftInfo, err := ReturnDraftInfoForDraft(draftId)
	if err != nil {
		row.Status = "error_read_draftinfo"
		row.Detail = err.Error()
		return row
	}
	if len(draftInfo.DraftOrder) != 10 {
		row.Status = "bad_draft_order"
		row.Detail = fmt.Sprintf("draftOrder has %d seats", len(draftInfo.DraftOrder))
		logCriticalDraftError("watchdog_bad_draft_order", draftId, picksMade, fmt.Errorf("%s", row.Detail))
		return row
	}

	// All 150 picks exist but the draft never flipped to complete: finish it.
	if picksMade >= 150 {
		row.NextPick = 150
		if dryRun {
			row.Status = "would_complete"
			return row
		}
		rt.LastPick = summary.Summary[149].PlayerInfo
		rt.IsDraftComplete = true
		if err := rt.Update(draftId); err != nil {
			row.Status = "error_write_rtdb"
			row.Detail = err.Error()
			logCriticalDraftError("watchdog_complete_write_failed", draftId, 150, err)
			return row
		}
		fmt.Printf(`{"severity":"ERROR","event":"watchdog_completed_draft","draftId":"%s"}`+"\n", draftId)
		go CloseDraftForAllUsers(draftId)
		row.Status = "completed"
		return row
	}

	nextPick := picksMade + 1
	round := (nextPick-1)/10 + 1
	pickInRound := nextPick - (round-1)*10
	var seat int
	if round%2 == 0 {
		seat = len(draftInfo.DraftOrder) - pickInRound
	} else {
		seat = pickInRound - 1
	}
	drafter := draftInfo.DraftOrder[seat].OwnerId
	pickLen := rt.PickLength
	if pickLen <= 0 {
		pickLen = 30
	}
	row.NextPick = nextPick
	row.NewDrafter = drafter

	if dryRun {
		row.Status = "would_repair"
		row.Detail = fmt.Sprintf("would set pick %d (round %d) on the clock for %s with a fresh %ds window", nextPick, round, drafter, pickLen)
		return row
	}

	// Step 0 — re-assert the LAST pick's three writes. In a mid-pick failure
	// any one of them may have been the write that was lost; each is
	// replay-idempotent (same-slot summary, deduped roster, same-value
	// playerState), so re-running them is safe and makes the record whole.
	if picksMade > 0 {
		last := summary.Summary[picksMade-1].PlayerInfo
		if err := last.UpdatePlayerInDraft(draftId); err != nil {
			// A SPLIT pick, not a lost write: playerState names a different
			// player for this slot than the summary does. Two auto-pick runs
			// each won a different state doc (ProcessNewPick fans its three
			// writes out concurrently), both aborted before advancing, and the
			// re-assert above can never get past the slot guard — so without
			// this the draft stays dead until somebody edits Firestore by hand
			// (2026-08-01, 2026-fast-draft-364 pick 9, ~20 minutes down).
			//
			// Heal toward the SUMMARY: it is what every player already sees and
			// what the rosters were built from. ForcePlayerStateToSummaryPick
			// refuses if the impostor is on anyone's roster, so a genuine pick
			// can never be released — in that case we fall through to the
			// original error and stay loud.
			if IsPlayerStateConflict(err) {
				if healErr := ForcePlayerStateToSummaryPick(draftId, last); healErr == nil {
					row.Healed = true
					if err = last.UpdatePlayerInDraft(draftId); err != nil {
						row.Status = "error_reassert_playerstate_after_heal"
						row.Detail = err.Error()
						logCriticalDraftError("watchdog_reassert_failed", draftId, picksMade, err)
						return row
					}
				} else {
					logCriticalDraftError("watchdog_playerstate_heal_refused", draftId, picksMade, healErr)
				}
			}
			if err != nil {
				row.Status = "error_reassert_playerstate"
				row.Detail = err.Error()
				logCriticalDraftError("watchdog_reassert_failed", draftId, picksMade, err)
				return row
			}
		}
		if err := UpdateRosterFromPick(draftId, last.OwnerAddress, last.Team, last.Position, last.PlayerId, last.DisplayName, last.Round); err != nil {
			row.Status = "error_reassert_roster"
			row.Detail = err.Error()
			logCriticalDraftError("watchdog_reassert_failed", draftId, picksMade, err)
			return row
		}
		rt.LastPick = last
	}

	// Step 1 — Firestore state/info first. If this fails we stop here; the
	// RTDB clock is still dead, so the next sweep retries the whole repair.
	draftInfo.CurrentPickNumber = nextPick
	draftInfo.CurrentRound = round
	draftInfo.PickInRound = pickInRound
	draftInfo.CurrentDrafter = drafter
	if err := draftInfo.Update(draftId); err != nil {
		row.Status = "error_write_draftinfo"
		row.Detail = err.Error()
		logCriticalDraftError("watchdog_repair_write_failed", draftId, nextPick, err)
		return row
	}

	// Step 2 — RTDB with a fresh full pick window. If THIS fails, the dead
	// RTDB clock keeps the draft flagged and the next sweep converges us.
	startAt := time.Now().Unix()
	rt.CurrentPickNumber = nextPick
	rt.CurrentRound = round
	rt.PickInRound = pickInRound
	rt.CurrentDrafter = drafter
	rt.PickStartTime = startAt
	rt.PickEndTime = startAt + pickLen
	rt.OnDeckDrafter = onDeckOwnerForNextPick(draftInfo)
	if err := rt.Update(draftId); err != nil {
		row.Status = "error_write_rtdb"
		row.Detail = err.Error()
		logCriticalDraftError("watchdog_repair_write_failed", draftId, nextPick, err)
		return row
	}

	// Step 3 — re-arm the standard auto-draft task so the normal machinery
	// owns the draft again. scheduleAutoDraftTask logs its own failures; if
	// it fails AND the user never picks, the clock dies again and the next
	// sweep repairs + re-arms once more.
	scheduleAutoDraftTask(draftId, drafter, nextPick, round, rt.PickEndTime)

	fmt.Printf(`{"severity":"ERROR","event":"watchdog_repaired","draftId":"%s","pick":%d,"drafter":"%s","deadForSec":%d}`+"\n", draftId, nextPick, drafter, deadFor)
	row.Status = "repaired"
	row.Detail = fmt.Sprintf("pick %d (round %d) back on the clock for %s, fresh %ds window, auto-task re-armed", nextPick, round, drafter, pickLen)
	return row
}

// ArmWatchdogChain schedules the next two sweeps as NAMED Cloud Tasks (one
// per minute). Names deduplicate, so overlapping arms from consecutive sweeps
// collapse into one task — and because each sweep arms two minutes ahead, a
// single lost or crashed sweep cannot kill the chain.
func ArmWatchdogChain() {
	adminKey := strings.TrimSpace(os.Getenv("ADMIN_API_KEY"))
	if adminKey == "" {
		fmt.Println("watchdog: ADMIN_API_KEY not set — cannot arm sweep chain")
		return
	}
	baseURL, err := resolveAPIBaseURL()
	if err != nil {
		fmt.Printf("watchdog: cannot resolve base URL to arm sweep chain: %v\n", err)
		return
	}
	url := baseURL + "/draft-actions/admin/watchdog/sweep"
	headers := map[string]string{
		"Content-Type": "application/json",
		"X-Admin-Key":  adminKey,
	}
	nowMinute := time.Now().Unix() / 60
	for i := int64(1); i <= 2; i++ {
		name := fmt.Sprintf("draft-watchdog-sweep-%d", nowMinute+i)
		fireAt := (nowMinute + i) * 60
		if err := utils.CreateNamedCloudTask(name, url, "{}", headers, fireAt); err != nil {
			fmt.Printf("watchdog: failed to arm sweep task %s: %v\n", name, err)
		}
	}
}
