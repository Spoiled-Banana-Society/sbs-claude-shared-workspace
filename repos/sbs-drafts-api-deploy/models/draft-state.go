package models

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/batchproof"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type DraftInfo struct {
	DraftId           string            `json:"draftId"`
	DisplayName       string            `json:"displayName"`
	DraftStartTime    int64             `json:"draftStartTime"`
	PickLength        int64             `json:"pickLength"`
	CurrentDrafter    string            `json:"currentDrafter"`
	CurrentPickNumber int               `json:"pickNumber"`
	CurrentRound      int               `json:"roundNum"`
	PickInRound       int               `json:"pickInRound"`
	DraftOrder        []LeagueUser      `json:"draftOrder"`
	ADP               []PlayerDraftInfo `json:"adp"`
}

func CreateDraftInfoForDraft(draftId string, pickLength int64, currentUsers []LeagueUser, leagueInfo *League) (*DraftInfo, error) {
	draftOrder := make([]LeagueUser, len(currentUsers))
	rand.New(rand.NewSource(time.Now().UTC().UnixNano()))
	perm := rand.Perm(len(currentUsers))

	for i, v := range perm {
		draftOrder[i] = currentUsers[v]
	}

	draftStartTime := time.Now().Unix() + 60

	res := &DraftInfo{
		DraftId:           draftId,
		DisplayName:       leagueInfo.DisplayName,
		DraftStartTime:    draftStartTime,
		PickLength:        pickLength,
		CurrentDrafter:    draftOrder[0].OwnerId,
		CurrentPickNumber: 1,
		CurrentRound:      1,
		PickInRound:       1,
		DraftOrder:        draftOrder,
	}

	return res, nil
}

// func findTheNextSaturday() (time.Time, error) {
// 	now := time.Now()
// 	year := now.Year()
// 	month := now.Month()
// 	day := 6
// 	hour := 18
// 	loc, err := time.LoadLocation("America/Los_Angeles")
// 	if err != nil {
// 		fmt.Println("Error finding the LA timezone or location")
// 		return time.Time{}, err
// 	}

// 	startTime := time.Date(year, month, day, hour, 0, 0, 0, loc)
// 	return startTime, nil

// }

func ReturnDraftInfoForDraft(draftId string) (*DraftInfo, error) {
	var info DraftInfo
	collectionString := fmt.Sprintf("drafts/%s/state", draftId)
	err := utils.Db.ReadDocument(collectionString, "info", &info)
	if err != nil {
		return nil, err
	}

	return &info, nil
}

func (info *DraftInfo) Update(draftId string) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "info", info)
	if err != nil {
		return err
	}

	return nil
}

type DraftSummaryObject struct {
	PlayerInfo PlayerStateInfo `json:"playerInfo"`
	// PfpInfo intentionally NOT stored on each pick. Embedding the
	// owner's PfpInfo into all 150 pick slots blew the 1 MB Firestore
	// doc-size limit when a user had a base64 data: URL as their avatar
	// (15 picks × 126 KB ≈ 1.9 MB → fill aborted, 10th joiner rolled back).
	// Frontend joins ownerAddress → owner doc for PFP at render time.
	PfpInfo PfpInfo `json:"pfpInfo,omitempty" firestore:"-"`
}

type DraftSummary struct {
	Summary []DraftSummaryObject `json:"summary"`
}

func ReturnDraftSummaryForDraft(draftId string) (*DraftSummary, error) {
	var sum DraftSummary
	collectionString := fmt.Sprintf("drafts/%s/state", draftId)
	err := utils.Db.ReadDocument(collectionString, "summary", &sum)
	if err != nil {
		return nil, err
	}

	// Self-heal: a pick can be absent from the summary doc even though it was
	// saved to playerState + rosters (seen on the final pick, when the summary
	// write loses a race with draft completion — the card + roster come out
	// fine but the board renders a blank slot). The board reads the summary,
	// so backfill any empty slot from playerState (the source of truth) and
	// persist the repair so it's fixed for good. Enrichment only — this never
	// clears or overwrites a slot that already has a player.
	missing := false
	for i := range sum.Summary {
		if sum.Summary[i].PlayerInfo.PlayerId == "" {
			missing = true
			break
		}
	}
	if missing {
		state := make(map[string]PlayerStateInfo)
		if sErr := utils.Db.ReadDocument(collectionString, "playerState", &state); sErr == nil {
			byPick := make(map[int]PlayerStateInfo, len(state))
			for _, p := range state {
				if p.PlayerId != "" && p.PickNum >= 1 {
					byPick[p.PickNum] = p
				}
			}
			healed := false
			for i := range sum.Summary {
				slot := &sum.Summary[i]
				if slot.PlayerInfo.PlayerId != "" {
					continue
				}
				p, ok := byPick[slot.PlayerInfo.PickNum]
				if !ok {
					continue
				}
				// Keep the slot's prefilled OwnerAddress/Round/PickNum; fill the player.
				slot.PlayerInfo.PlayerId = p.PlayerId
				slot.PlayerInfo.DisplayName = p.DisplayName
				slot.PlayerInfo.Team = p.Team
				slot.PlayerInfo.Position = p.Position
				if slot.PlayerInfo.OwnerAddress == "" {
					slot.PlayerInfo.OwnerAddress = p.OwnerAddress
				}
				if slot.PlayerInfo.Round == 0 {
					slot.PlayerInfo.Round = p.Round
				}
				healed = true
			}
			if healed {
				if wErr := sum.Update(draftId); wErr != nil {
					fmt.Printf("WARN could not persist healed summary for %s: %v\r", draftId, wErr)
				} else {
					fmt.Printf("INFO healed missing summary slot(s) for %s from playerState\r", draftId)
				}
			}
		} else {
			fmt.Printf("WARN summary has empty slot but playerState read failed for %s: %v\r", draftId, sErr)
		}
	}

	return &sum, nil
}

func CreateDraftSummaryForDraft(draftId string, draftOrder []LeagueUser) (*DraftSummary, error) {
	// Summary stores only PlayerInfo per pick. Each pick carries the
	// OwnerAddress, and the frontend looks up the avatar + display name
	// from the owner doc at render time. Embedding the full PfpInfo into
	// all 150 slots was the source of the 1 MB Firestore-doc-size overflow
	// when any user had a large avatar (notably base64 data: URLs).
	sum := &DraftSummary{
		Summary: make([]DraftSummaryObject, 0),
	}

	pickNum := 1
	for i := 1; i <= 15; i++ {
		round := i
		for j := 1; j <= 10; j++ {
			pickInRound := j
			var drafter string
			if round%2 == 0 {
				drafter = draftOrder[len(draftOrder)-pickInRound].OwnerId
			} else {
				drafter = draftOrder[pickInRound-1].OwnerId
			}

			obj := PlayerStateInfo{
				PickNum:      pickNum,
				OwnerAddress: drafter,
				Round:        round,
			}

			sum.Summary = append(sum.Summary, DraftSummaryObject{PlayerInfo: obj})
			pickNum++
		}
	}
	return sum, nil
}

func (s *DraftSummary) Update(draftId string) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", s)
	if err != nil {
		return err
	}

	return nil
}

type ConnectionList struct {
	List map[string]bool `json:"list"`
}

func CreateNewConnectionList(info DraftInfo) *ConnectionList {
	res := make(map[string]bool)
	for i := 0; i < len(info.DraftOrder); i++ {
		res[info.DraftOrder[i].OwnerId] = false
	}

	return &ConnectionList{
		List: res,
	}
}

func ReturnConnectionListForDraft(draftId string) (*ConnectionList, error) {
	var cl ConnectionList
	collectionString := fmt.Sprintf("drafts/%s/state", draftId)
	err := utils.Db.ReadDocument(collectionString, "connectionList", &cl)
	if err != nil {
		return nil, err
	}

	return &cl, nil
}

func (connList *ConnectionList) Update(draftId string) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "connectionList", connList)
	if err != nil {
		return err
	}

	return nil
}

type RosterPlayer struct {
	Team        string `json:"team"`
	PlayerId    string `json:"playerId"`
	DisplayName string `json:"displayName"`
}

type TokenRoster struct {
	DST []RosterPlayer `json:"DST"`
	QB  []RosterPlayer `json:"QB"`
	RB  []RosterPlayer `json:"RB"`
	TE  []RosterPlayer `json:"TE"`
	WR  []RosterPlayer `json:"WR"`
}

type DraftStateRoster struct {
	DST []RosterPlayer `json:"DST"`
	QB  []RosterPlayer `json:"QB"`
	RB  []RosterPlayer `json:"RB"`
	TE  []RosterPlayer `json:"TE"`
	WR  []RosterPlayer `json:"WR"`
	PFP PfpInfo        `json:"PFP"`
}

func NewEmptyRoster(ownerId string) *TokenRoster {
	// var owner Owner
	// err := utils.Db.ReadDocument("owners", ownerId, &owner)
	// if err != nil {
	// 	fmt.Println("ERROR reading owners document ot create empty roster object: ", err)
	// 	return nil, err
	// }

	return &TokenRoster{
		DST: make([]RosterPlayer, 0),
		QB:  make([]RosterPlayer, 0),
		RB:  make([]RosterPlayer, 0),
		TE:  make([]RosterPlayer, 0),
		WR:  make([]RosterPlayer, 0),
	}
}

type RosterState struct {
	Rosters map[string]*DraftStateRoster `json:"rosters"`
}

func CreateEmptyRosterState(info DraftInfo) *RosterState {
	data := make(map[string]*DraftStateRoster)

	for i := 0; i < len(info.DraftOrder); i++ {
		var owner Owner
		err := utils.Db.ReadDocument("owners", info.DraftOrder[i].OwnerId, &owner)
		if err != nil {
			fmt.Println("Error reading owners document: ", err)
			continue
		}

		res := &DraftStateRoster{
			DST: make([]RosterPlayer, 0),
			QB:  make([]RosterPlayer, 0),
			RB:  make([]RosterPlayer, 0),
			TE:  make([]RosterPlayer, 0),
			WR:  make([]RosterPlayer, 0),
			PFP: owner.PFP,
		}

		data[info.DraftOrder[i].OwnerId] = res
	}

	return &RosterState{
		Rosters: data,
	}
}

type RosterPlayerInfo struct {
	// unique player Id will probably just be the team and position such as BUFQB
	PlayerId string `json:"playerId"`
	// holds the state object for player
	PlayerStateInfo PlayerStateInfo `json:"playerStateInfo"`
	Stats           StatsObject     `json:"stats"`
}

type FullInfoRoster struct {
	DST []RosterPlayerInfo `json:"DST"`
	QB  []RosterPlayerInfo `json:"QB"`
	RB  []RosterPlayerInfo `json:"RB"`
	TE  []RosterPlayerInfo `json:"TE"`
	WR  []RosterPlayerInfo `json:"WR"`
	PFP PfpInfo            `json:"PFP"`
}

func ReturnRostersForDraft(draftId string) (*map[string]FullInfoRoster, error) {
	var data RosterState
	collectionString := fmt.Sprintf("drafts/%s/state", draftId)
	err := utils.Db.ReadDocument(collectionString, "rosters", &data)
	if err != nil {
		return nil, err
	}

	state := make(map[string]PlayerStateInfo)
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "playerState", &state)
	if err != nil {
		return nil, err
	}

	stats := StatsMap{
		Players: make(map[string]StatsObject),
	}
	err = utils.Db.ReadDocument("playerStats2026", "playerMap", &stats)
	if err != nil {
		return nil, err
	}

	res := make(map[string]FullInfoRoster, 0)

	for key, roster := range data.Rosters {
		newRoster := FullInfoRoster{
			DST: make([]RosterPlayerInfo, 0),
			QB:  make([]RosterPlayerInfo, 0),
			RB:  make([]RosterPlayerInfo, 0),
			TE:  make([]RosterPlayerInfo, 0),
			WR:  make([]RosterPlayerInfo, 0),
			PFP: roster.PFP,
		}
		for i := 0; i < len(roster.DST); i++ {
			obj := roster.DST[i]
			newRoster.DST = append(newRoster.DST, RosterPlayerInfo{
				PlayerId:        obj.PlayerId,
				PlayerStateInfo: state[obj.PlayerId],
				Stats:           stats.Players[obj.PlayerId],
			})
		}
		for i := 0; i < len(roster.QB); i++ {
			obj := roster.QB[i]
			newRoster.QB = append(newRoster.QB, RosterPlayerInfo{
				PlayerId:        obj.PlayerId,
				PlayerStateInfo: state[obj.PlayerId],
				Stats:           stats.Players[obj.PlayerId],
			})
		}
		for i := 0; i < len(roster.RB); i++ {
			obj := roster.RB[i]
			newRoster.RB = append(newRoster.RB, RosterPlayerInfo{
				PlayerId:        obj.PlayerId,
				PlayerStateInfo: state[obj.PlayerId],
				Stats:           stats.Players[obj.PlayerId],
			})
		}
		for i := 0; i < len(roster.TE); i++ {
			obj := roster.TE[i]
			newRoster.TE = append(newRoster.TE, RosterPlayerInfo{
				PlayerId:        obj.PlayerId,
				PlayerStateInfo: state[obj.PlayerId],
				Stats:           stats.Players[obj.PlayerId],
			})
		}
		for i := 0; i < len(roster.WR); i++ {
			obj := roster.WR[i]
			newRoster.WR = append(newRoster.WR, RosterPlayerInfo{
				PlayerId:        obj.PlayerId,
				PlayerStateInfo: state[obj.PlayerId],
				Stats:           stats.Players[obj.PlayerId],
			})
		}
		res[key] = newRoster
	}

	return &res, nil
}

func GetDefaultPlayerState() (map[string]PlayerStateInfo, error) {
	data := make(map[string]PlayerStateInfo)

	err := utils.Db.ReadDocument("playerStats2026", "defaultPlayerDraftState", &data)
	if err != nil {
		return nil, err
	}

	return data, nil
}

func (rs *RosterState) Update(draftId string) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", rs)
	if err != nil {
		return err
	}

	return nil
}

// makeLeagueLevel stamps every card in the draft with an arbitrary Level —
// the generalized form of MakeLeagueJackpot/HOF, added for the JackHOF
// dual-type (rolling-lane era). Same best-effort/deferred semantics.
func makeLeagueLevel(draftId string, level string) error {
	cards, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/cards", draftId)).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error in reading all of the draft tokens in this league: ", err)
		return err
	}
	for i := 0; i < len(cards); i++ {
		snap := cards[i]
		var token DraftToken
		err = snap.DataTo(&token)
		if err != nil {
			fmt.Println("Error reading data into draft Token object: ", err)
			return err
		}
		token.Level = level
		err = token.updateInUseDraftTokenInDatabase(draftId)
		if err != nil {
			fmt.Printf("error updating token to level %s: %v\n", level, err)
			return err
		}
	}
	return nil
}

// unionSortedIds merges two id lists into a sorted, de-duplicated slice.
// Used by the rolling-lane era to APPEND cycle globals to the tracker's
// historical arrays without ever dropping pre-cutover history.
func unionSortedIds(a, b []int) []int {
	seen := make(map[int]bool, len(a)+len(b))
	out := make([]int, 0, len(a)+len(b))
	for _, id := range a {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, id := range b {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out
}

func MakeLeagueHOF(draftId string, league *League) error {
	cards, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/cards", draftId)).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error in reading all of the draft tokens in this league: ", err)
		return err
	}
	for i := 0; i < len(cards); i++ {
		snap := cards[i]
		var token DraftToken
		err = snap.DataTo(&token)
		if err != nil {
			fmt.Println("Error reading data into draft Token object: ", err)
			return err
		}
		token.Level = "Hall of Fame"
		err = token.updateInUseDraftTokenInDatabase(draftId)
		if err != nil {
			fmt.Println("error updating token in MakeLeagueHOF: ", err)
			return err
		}
	}
	return nil
}

func MakeLeagueJackpot(draftId string, league *League) error {
	cards, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/cards", draftId)).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error in reading all of the draft tokens in this league: ", err)
		return err
	}
	for i := 0; i < len(cards); i++ {
		snap := cards[i]
		var token DraftToken
		err = snap.DataTo(&token)
		if err != nil {
			fmt.Println("Error reading data into draft Token object: ", err)
			return err
		}
		token.Level = "Jackpot"
		err = token.updateInUseDraftTokenInDatabase(draftId)
		if err != nil {
			fmt.Println("error updating token in Jackpot: ", err)
			return err
		}
	}
	return nil
}

type Players struct {
	Players map[string]PlayerStateInfo `json:"players"`
}

func CreateLeagueDraftStateUponFilling(draftId string, draftType string) error {
	fillStart := time.Now()
	defer func() {
		fmt.Printf("[fill-timing] CreateLeagueDraftStateUponFilling(%s) total %v\n", draftId, time.Since(fillStart))
	}()
	var leagueInfo League
	err := utils.Db.ReadDocument("drafts", draftId, &leagueInfo)
	if err != nil {
		fmt.Println("Error in reading the league document")
		return err
	}

	// Wheel-won special drafts have their Jackpot/HOF Level set BEFORE fill. They
	// run in their OWN lane: they never enter the per-100 batch (no
	// FilledLeaguesCount, no VRF JP/HOF slot assignment, no batch proof), get
	// their own counter + "Special Draft Jackpot/HOF #N" name, and KEEP the level
	// they were won with. This keeps the guaranteed 1 JP + 5 HOF per 100 a pure
	// paid-draft pool, which is the only way to honor it under VRF (batch
	// positions are committed before fills, so a special can't be slotted as Pro).
	isSpecialDraft := leagueInfo.Level == "Jackpot" || leagueInfo.Level == "Hall of Fame" || leagueInfo.Level == "JackHOF"
	specialLevel := leagueInfo.Level

	// PHASE 1: atomic increment of the global tracker.
	//
	// FilledLeaguesCount + CurrentLive/SlowDraftCount must update in a
	// single Firestore transaction so two parallel league fills can't
	// both read the same starting value and collide on the BBB # they
	// assign. Without this, simultaneous fills produced two leagues with
	// the same DisplayName and a stuck counter.
	var counts DraftLeagueTracker
	trackerRef := utils.Db.Client.Collection("drafts").Doc("draftTracker")
	err = utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(trackerRef)
		if err != nil {
			return err
		}
		if err := doc.DataTo(&counts); err != nil {
			return err
		}
		if strings.ToLower(draftType) == "fast" {
			counts.CurrentLiveDraftCount++
		} else {
			counts.CurrentSlowDraftCount++
		}
		if isSpecialDraft {
			counts.SpecialDraftCount++ // own lane — NOT the per-100 batch
		} else {
			counts.FilledLeaguesCount++
			// Provisional reveal-anchor, recorded ATOMICALLY with the count so the
			// batch dashboard holds this draft's JP/HOF deduction + odds from the
			// instant the count moves — no flicker, and never revealed early (even
			// across the up-to-120s VRF wait at a batch boundary). StartTime=0 is a
			// "filled, slot not yet timed" sentinel; the real DraftStartTime is
			// stamped in after the live node is written (see reveal-anchor stamp
			// below). The batch-progress stream treats a 0-StartTime entry as held.
			counts.RecentFills = append(counts.RecentFills, RecentFill{Id: counts.FilledLeaguesCount, StartTime: 0})
			if len(counts.RecentFills) > 10 {
				counts.RecentFills = counts.RecentFills[len(counts.RecentFills)-10:]
			}
		}
		return tx.Set(trackerRef, &counts)
	})
	if err != nil {
		fmt.Println("Error atomically incrementing draftTracker:", err)
		return err
	}

	// PHASE 2: provably-fair batch proof. Every fill calls
	// EnsureBatchCommitted — the Manager has a per-batch lock and
	// short-circuits on already-derived batches, so position 1+ pays
	// only one Firestore read and gets back the cached positions.
	//
	// At the boundary (positionInBatch == 0 of a NEW batch), this is the
	// flow that drives derivation: for vrf-commit it submits the salt
	// commit + VRF request (or picks up the pre-request fired at the
	// previous batch's close), waits for fulfillment, derives positions
	// from sha256(salt || randomness), and persists batch_proofs/{N}.
	//
	// Best-effort: if the on-chain step fails, log and fall back to
	// whatever HofLeagueIds / JackpotLeagueIds the tracker already had.
	postIncrement := counts.FilledLeaguesCount
	batchNumber := (postIncrement-1)/batchproof.BatchSize + 1
	positionInBatch := (postIncrement - 1) % batchproof.BatchSize

	// ROLLING-LANE ERA SWITCH (spec: rolling_windows_jackhof v2). Active when
	// the tracker carries RollingStartDraft and this draft is at/past it. In
	// that era the fixed per-100 batch is replaced by two independent lane
	// cycles (jp / hof); their CURRENT-cycle globals get UNIONED into the
	// tracker id arrays (never replacing history). Deleting the tracker field
	// (or LANES_DISABLED=1) drops us straight back to the legacy path below.
	rollingActive := counts.RollingStartDraft > 0 &&
		postIncrement >= counts.RollingStartDraft &&
		!batchproof.LanesDisabled()

	var batchJpGlobals, batchHofGlobals []int
	if mgr := batchproof.Default(); mgr != nil && !isSpecialDraft {
		if disabled, msg := mgr.Disabled(); disabled {
			fmt.Printf("[batchproof] disabled, skipping batch %d derivation: %s\n", batchNumber, msg)
		} else if rollingActive {
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			jpCycle, hofCycle, lnErr := mgr.EnsureLaneCyclesFor(ctx, postIncrement)
			cancel()
			if lnErr != nil {
				fmt.Printf("[lanes] EnsureLaneCyclesFor draft %d failed: %v — falling back to tracker lists\n", postIncrement, lnErr)
			} else {
				batchJpGlobals = unionSortedIds(counts.JackpotLeagueIds, jpCycle)
				batchHofGlobals = unionSortedIds(counts.HofLeagueIds, hofCycle)
			}
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			jp, hof, bpErr := mgr.EnsureBatchCommitted(ctx, batchNumber)
			cancel()
			if bpErr != nil {
				fmt.Printf("[batchproof] EnsureBatchCommitted batch %d failed: %v\n", batchNumber, bpErr)
			} else {
				batchJpGlobals = jp
				batchHofGlobals = hof
				if positionInBatch == 0 {
					fmt.Printf("[batchproof] committed batch %d → jackpot=%v hof=%v\n", batchNumber, jp, hof)
				}
			}
		}
	} else {
		fmt.Printf("[batchproof] manager not initialized, skipping batch %d commit\n", batchNumber)
	}

	// PHASE 3: persist batch's HOF/JP lists onto the tracker atomically.
	// Even though every fill in the batch gets the same lists from
	// EnsureBatchCommitted, we only write them through the tracker once
	// per batch (positionInBatch == 0). For position 1+ they're already
	// there from a previous fill; we still cross-update here as a
	// belt-and-suspenders self-heal in case the boundary fill failed.
	if len(batchJpGlobals) > 0 || len(batchHofGlobals) > 0 {
		err = utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
			doc, err := tx.Get(trackerRef)
			if err != nil {
				return err
			}
			var fresh DraftLeagueTracker
			if err := doc.DataTo(&fresh); err != nil {
				return err
			}
			fresh.JackpotLeagueIds = batchJpGlobals
			fresh.HofLeagueIds = batchHofGlobals
			counts = fresh
			return tx.Set(trackerRef, &fresh)
		})
		if err != nil {
			fmt.Printf("[batchproof] failed to persist batch %d lists to tracker: %v\n", batchNumber, err)
		}
	}

	// The per-card Level stamp (MakeLeagueJackpot/HOF) is DEFERRED below until
	// after RTDB + the first Cloud Task — those do ~10 sequential Firestore
	// writes, and running them before RTDB risks a stuck/frozen draft. Per-card
	// Level is cosmetic; we set the league doc's Level here and fan out later.
	isJackpot := false
	isHOF := false
	if isSpecialDraft {
		// Own lane: its own name + counter, KEEP the wheel level, NO slot reveal.
		tierName := "Jackpot"
		if specialLevel == "Hall of Fame" {
			tierName = "HOF"
		} else if specialLevel == "JackHOF" {
			// Wheel-won dual-type pass (0.1% segment) — both perks, one draft.
			tierName = "JackHOF"
		}
		leagueInfo.DisplayName = fmt.Sprintf("%s #%d (from Wheel)", tierName, counts.SpecialDraftCount)
		leagueInfo.Level = specialLevel
		isJackpot = specialLevel == "Jackpot" || specialLevel == "JackHOF"
		isHOF = specialLevel == "Hall of Fame" || specialLevel == "JackHOF"
	} else {
		leagueInfo.DisplayName = fmt.Sprintf("BBB #%d", counts.FilledLeaguesCount)
		// Slot reveal — the guaranteed specials ride these committed positions.
		// Membership is independent per array; the SAME id in BOTH arrays is a
		// JackHOF (rolling era only — legacy batches can't produce one).
		for i := 0; i < len(counts.HofLeagueIds); i++ {
			if counts.HofLeagueIds[i] == counts.FilledLeaguesCount {
				leagueInfo.Level = "Hall of Fame"
				isHOF = true
				break
			}
		}
		for i := 0; i < len(counts.JackpotLeagueIds); i++ {
			if counts.JackpotLeagueIds[i] == counts.FilledLeaguesCount {
				leagueInfo.Level = "Jackpot"
				isJackpot = true
				break
			}
		}
		if isJackpot && isHOF {
			// Canonical dual-type NFT/league level per the v2 spec.
			leagueInfo.Level = "JackHOF"
		}
		// Rolling era: a hit may have completed a lane's cycle — reveal the
		// cycle's salt on-chain and open the next cycle (background; never
		// blocks the fill path).
		if rollingActive && (isJackpot || isHOF) {
			if mgr := batchproof.Default(); mgr != nil {
				mgr.LaneAfterAssignment(counts.FilledLeaguesCount, isJackpot, isHOF)
			}
		}
	}

	err = utils.Db.CreateOrUpdateDocument("drafts", draftId, &leagueInfo)
	if err != nil {
		return err
	}

	// Per-user draft state: read the card, stamp league info + display name,
	// and seed an empty queue. Each user is independent (different token doc,
	// different queue doc), so run all 10 concurrently instead of ~30
	// sequential Firestore round-trips — this is the main 10th-joiner latency
	// win. Stays synchronous: we wait for all of them before returning.
	userStart := time.Now()
	userFns := make([]func() error, len(leagueInfo.CurrentUsers))
	for i := range leagueInfo.CurrentUsers {
		i := i
		userFns[i] = func() error {
			rosterObj := NewEmptyRoster(leagueInfo.CurrentUsers[i].OwnerId)
			token := DraftToken{
				Roster: rosterObj,
			}
			if err := utils.Db.ReadDocument("draftTokens", leagueInfo.CurrentUsers[i].TokenId, &token); err != nil {
				return err
			}

			if token.LeagueId == "" {
				token.LeagueId = draftId
				token.DraftType = draftType
			}

			token.LeagueDisplayName = leagueInfo.DisplayName
			if err := token.updateInUseDraftTokenInDatabase(draftId); err != nil {
				return err
			}
			fmt.Println("Updated display name on card ", leagueInfo.CurrentUsers[i].TokenId)

			// add queues
			var emptyQueue DraftQueue
			return UpdateQueueForDraft(draftId, leagueInfo.CurrentUsers[i].OwnerId, emptyQueue)
		}
	}
	if err = runConcurrently(userFns...); err != nil {
		return err
	}
	fmt.Printf("[fill-timing] per-user state for %d users in %v (draft %s)\n", len(leagueInfo.CurrentUsers), time.Since(userStart), draftId)

	// Tracker increments + batch lists were already persisted atomically
	// in PHASE 1 / PHASE 3 above. No bare CreateOrUpdate here — that would
	// re-introduce the lost-update race we just fixed.

	// Provably-fair batch proof reveal — at the END of every batch (the
	// 100th draft to fill), reveal the server seed on-chain so anyone
	// can verify the slot derivation. Async, fire-and-forget: the reveal
	// can take up to 90s and we don't want to block the fill path. If
	// the reveal fails, the next batch start will see chain.Revealed
	// false and a manual ops command can retry — see batchproof.Default().RevealBatch.
	if positionInBatch == batchproof.BatchSize-1 {
		if mgr := batchproof.Default(); mgr != nil {
			if disabled, _ := mgr.Disabled(); !disabled {
				// Single goroutine that runs PRE-REQUEST FIRST, then REVEAL.
				// Both share the signer's nonce, so they must be serialized
				// (concurrent goroutines collided on nonce in the past →
				// "replacement transaction underpriced"). Pre-request is
				// time-sensitive (the next batch's first fill is waiting on
				// it); reveal is just the public receipt for the closing
				// batch and can wait. Hence: pre-request → reveal.
				go func(closingBatch int) {
					nextBatch := closingBatch + 1

					ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
					if err := mgr.PreRequestNextBatchRandomness(ctx, nextBatch); err != nil {
						fmt.Printf("[batchproof] PreRequestNextBatchRandomness %d failed: %v\n", nextBatch, err)
					} else if mgr.Variant() == batchproof.VariantVRF {
						fmt.Printf("[batchproof] pre-requested VRF for batch %d\n", nextBatch)
					}
					cancel()

					ctx, cancel = context.WithTimeout(context.Background(), 120*time.Second)
					if err := mgr.RevealBatch(ctx, closingBatch); err != nil {
						fmt.Printf("[batchproof] RevealBatch %d failed: %v\n", closingBatch, err)
					} else {
						fmt.Printf("[batchproof] revealed batch %d\n", closingBatch)
					}
					cancel()
				}(batchNumber)
			}
		}
	}

	if len(leagueInfo.CurrentUsers) != 10 {
		return fmt.Errorf("there is not 10 users in this league so we can not make a draft state for an unfilled league")
	}

	var pickLength int64
	if strings.ToLower(leagueInfo.DraftType) == "fast" {
		pickLength = 30
	} else {
		pickLength = 3600 * 8
	}

	info, err := CreateDraftInfoForDraft(draftId, pickLength, leagueInfo.CurrentUsers, &leagueInfo)
	if err != nil {
		return err
	}
	if err := info.Update(draftId); err != nil {
		return err
	}

	data, err := GetDefaultPlayerState()
	if err != nil {
		return err
	}
	fmt.Println("Data returned from get default player state")

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "playerState", &data)
	if err != nil {
		return err
	}

	summary, err := CreateDraftSummaryForDraft(draftId, info.DraftOrder)
	if err != nil {
		fmt.Println("ERROR creating draft summary for draft: ", err)
		return err
	}

	if err := summary.Update(draftId); err != nil {
		return err
	}
	connList := CreateNewConnectionList(*info)
	if err := connList.Update(draftId); err != nil {
		return err
	}
	rosterMap := CreateEmptyRosterState(*info)
	if err := rosterMap.Update(draftId); err != nil {
		return err
	}

	ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", leagueInfo.LeagueId))

	firstPickInfo := RealTimeDraftInfo{
		CurrentDrafter:    info.DraftOrder[0].OwnerId,
		CurrentPickNumber: 1,
		CurrentRound:      1,
		PickInRound:       1,
		DraftStartTime:    info.DraftStartTime,
		PickStartTime:     info.DraftStartTime,
		LastPick:          PlayerStateInfo{},
		PickLength:        info.PickLength,
	}
	// Stamp the resolved type onto the live node so both devices read the same
	// Pro/HOF/Jackpot the instant the slot reveal lands — no per-device owner
	// lookup, no desync. Derived from the same isJackpot/isHOF decision above
	// (which already folds in wheel-won special drafts via specialLevel).
	if isJackpot && isHOF {
		// Canonical RTDB string for a dual-type draft (frontend also tolerates
		// variants, but 'jackhof' is the contract — v2 spec §3).
		firstPickInfo.Type = "jackhof"
	} else if isJackpot {
		firstPickInfo.Type = "Jackpot"
	} else if isHOF {
		firstPickInfo.Type = "Hall of Fame"
	} else {
		firstPickInfo.Type = "Pro"
	}
	if strings.ToLower(leagueInfo.DraftType) == "slow" {
		firstPickInfo.PickEndTime = SlowDraftPickEndUnix(info.DraftStartTime, info.PickLength)
	} else {
		firstPickInfo.PickEndTime = info.DraftStartTime + info.PickLength
	}

	fmt.Printf("[league#] rtdb.write.start draftId=%s displayName=%q numPlayers=%d\n", draftId, leagueInfo.DisplayName, leagueInfo.NumPlayers)
	if err := ref.Set(context.TODO(), map[string]interface{}{
		"numPlayers":        leagueInfo.NumPlayers,
		"realTimeDraftInfo": firstPickInfo,
		"displayName":       leagueInfo.DisplayName,
	}); err != nil {
		fmt.Printf("[league#] rtdb.write.error draftId=%s err=%v\n", draftId, err)
		return err
	}
	fmt.Printf("[league#] rtdb.write.ok draftId=%s displayName=%q\n", draftId, leagueInfo.DisplayName)

	// Reveal-anchor stamp: now that the live node is written and DraftStartTime is
	// final, replace this draft's provisional (StartTime=0) RecentFills entry with
	// its real DraftStartTime. The batch dashboard then reveals its JP/HOF
	// deduction + odds exactly when the slot machine lands (DraftStartTime-39s =
	// fill+21s). Runs AFTER the RTDB write so it never delays the draft start, and
	// is best-effort/cosmetic — a failure just leaves the entry held (revealed
	// late once it rolls out of the window), never early, and never affects the
	// fill, picks, or VRF distribution. Only batch drafts have a provisional entry.
	if !isSpecialDraft {
		fillId := counts.FilledLeaguesCount
		startTime := info.DraftStartTime
		if rfErr := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
			doc, err := tx.Get(trackerRef)
			if err != nil {
				return err
			}
			var fresh DraftLeagueTracker
			if err := doc.DataTo(&fresh); err != nil {
				return err
			}
			found := false
			for i := range fresh.RecentFills {
				if fresh.RecentFills[i].Id == fillId {
					fresh.RecentFills[i].StartTime = startTime
					found = true
					break
				}
			}
			if !found {
				// Provisional entry already rolled out of the 10-deep window
				// (only under an implausible burst). Re-add the real anchor so the
				// reveal still gates correctly.
				fresh.RecentFills = append(fresh.RecentFills, RecentFill{Id: fillId, StartTime: startTime})
				if len(fresh.RecentFills) > 10 {
					fresh.RecentFills = fresh.RecentFills[len(fresh.RecentFills)-10:]
				}
			}
			return tx.Set(trackerRef, &fresh)
		}); rfErr != nil {
			fmt.Printf("[reveal-anchor] failed to stamp DraftStartTime for fill id=%d: %v\n", fillId, rfErr)
		}
	}

	fmt.Printf("First pick info: %v\n for draft %s has created the real time draft info\n", firstPickInfo, draftId)

	// Build the auto-draft URL based on environment
	autoDraftUrl, err := buildAutoDraftURL(draftId, firstPickInfo.CurrentDrafter)
	if err != nil {
		fmt.Printf("Error building auto-draft URL for draft %s, owner %s: %v\n", draftId, firstPickInfo.CurrentDrafter, err)
		return err
	}

	// Create the payload
	payload := map[string]interface{}{
		"currentPickNumber": 1,
		"currentRound":      1,
		"isServerPick":      true,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("Error marshaling auto-draft payload for pick %d: %v\n", 1, err)
		return err
	}

	// Create the cloud task
	err = utils.CreateCloudTask(autoDraftUrl, string(payloadBytes), firstPickInfo.PickEndTime-2)
	if err != nil {
		fmt.Printf("Error scheduling auto-draft cloud task for draft %s, pick %d: %v\n", draftId, 1, err)
		return err
	}

	fmt.Printf("Successfully scheduled auto-draft cloud task for draft %s, pick %d (round %d) at timestamp %d\n",
		draftId, 1, 1, firstPickInfo.PickEndTime-5)

	// DEFERRED: per-card Level write for JP/HOF drafts. Best-effort,
	// run AFTER RTDB + Cloud Task have committed so a partial failure
	// here can never freeze the draft at pick 1. The leagueInfo doc
	// already has Level set, so the slot machine reveal works either
	// way; the per-card Level field is purely a cosmetic hint for the
	// draft-card UI. If this errors, log and move on — a sweeper can
	// reconcile later and the draft will still draft normally.
	if isJackpot && isHOF {
		if mlErr := makeLeagueLevel(draftId, "JackHOF"); mlErr != nil {
			fmt.Printf("[deferred] MakeLeagueJackHOF for draft %s failed (non-fatal — RTDB already up): %v\n", draftId, mlErr)
		}
	} else if isJackpot {
		if mlErr := MakeLeagueJackpot(draftId, &leagueInfo); mlErr != nil {
			fmt.Printf("[deferred] MakeLeagueJackpot for draft %s failed (non-fatal — RTDB already up): %v\n", draftId, mlErr)
		}
	} else if isHOF {
		if mlErr := MakeLeagueHOF(draftId, &leagueInfo); mlErr != nil {
			fmt.Printf("[deferred] MakeLeagueHOF for draft %s failed (non-fatal — RTDB already up): %v\n", draftId, mlErr)
		}
	}
	ownerIDs := make([]string, len(leagueInfo.CurrentUsers))
	for i := range leagueInfo.CurrentUsers {
		ownerIDs[i] = leagueInfo.CurrentUsers[i].OwnerId
	}
	go NotifyDraftStartingSMS(draftId, leagueInfo.DisplayName, ownerIDs)

	return nil
}

// rosterHasPlayer: true if this exact player is already on the position list.
// Makes a re-run of a half-saved pick (retry after a mid-pick failure)
// harmless — the player can never be added twice. Part of the 2026-06-10
// freeze fix: retries are only safe if every step is safe to repeat.
func rosterHasPlayer(list []RosterPlayer, playerId string) bool {
	for _, p := range list {
		if p.PlayerId == playerId {
			return true
		}
	}
	return false
}

func UpdateRosterFromPick(draftId, address, teamName, position, playerId, displayName string, roundNum int) error {
	data := &RosterState{
		Rosters: make(map[string]*DraftStateRoster),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &data)
	if err != nil {
		fmt.Println("Error reading in roster map from db")
		return err
	}

	newPlayer := RosterPlayer{Team: teamName, PlayerId: playerId, DisplayName: displayName}
	switch strings.ToLower(position) {
	case "qb":
		if !rosterHasPlayer(data.Rosters[address].QB, playerId) {
			data.Rosters[address].QB = append(data.Rosters[address].QB, newPlayer)
		}
	case "rb":
		if !rosterHasPlayer(data.Rosters[address].RB, playerId) {
			data.Rosters[address].RB = append(data.Rosters[address].RB, newPlayer)
		}
	case "wr":
		if !rosterHasPlayer(data.Rosters[address].WR, playerId) {
			data.Rosters[address].WR = append(data.Rosters[address].WR, newPlayer)
		}
	case "te":
		if !rosterHasPlayer(data.Rosters[address].TE, playerId) {
			data.Rosters[address].TE = append(data.Rosters[address].TE, newPlayer)
		}
	case "dst":
		if !rosterHasPlayer(data.Rosters[address].DST, playerId) {
			data.Rosters[address].DST = append(data.Rosters[address].DST, newPlayer)
		}
	}

	size := 0
	size += len(data.Rosters[address].QB)
	size += len(data.Rosters[address].RB)
	size += len(data.Rosters[address].WR)
	size += len(data.Rosters[address].TE)
	size += len(data.Rosters[address].DST)

	if size > roundNum {
		fmt.Println("This user is trying to pick an extra player and would have more players than allowed in round ", roundNum)
		return fmt.Errorf("error this user is trying to pick an extra player and would have more players than allowed in round %d", roundNum)
	}

	fmt.Printf("Just added player %s to roster to make a total of %d players on the roster\r", playerId, (len(data.Rosters[address].DST) + len(data.Rosters[address].QB) + len(data.Rosters[address].RB) + len(data.Rosters[address].TE) + len(data.Rosters[address].WR)))

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &data)
	if err != nil {
		fmt.Println("Error updating rosters in draft ", draftId)
		return err
	}

	return nil
}
