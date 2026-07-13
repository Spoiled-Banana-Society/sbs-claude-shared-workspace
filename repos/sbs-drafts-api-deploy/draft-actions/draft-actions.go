package draftActions

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

// requireAdminKey gates a handler with the X-Admin-Key header. Fails closed
// when ADMIN_API_KEY is not configured so a missing-env-var deploy can't
// silently expose admin endpoints to the internet.
func requireAdminKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		expected := strings.TrimSpace(os.Getenv("ADMIN_API_KEY"))
		if expected == "" {
			http.Error(w, "ADMIN_API_KEY not configured", http.StatusServiceUnavailable)
			return
		}
		provided := strings.TrimSpace(r.Header.Get("X-Admin-Key"))
		if provided == "" || provided != expected {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

type DraftActionResources struct{}

type AutoDraftRequest struct {
	CurrentPickNumber int  `json:"currentPickNumber"`
	CurrentRound      int  `json:"currentRound"`
	IsServerPick      bool `json:"isServerPick"`
}

type ManualPickRequest struct {
	PlayerId    string `json:"playerId"`
	DisplayName string `json:"displayName"`
	Team        string `json:"team"`
	Position    string `json:"position"`
}

func (dra *DraftActionResources) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/{draftId}/owner/{ownerId}/preferences", dra.getDraftPreferences)
	r.Patch("/{draftId}/owner/{ownerId}/preferences", dra.patchDraftPreferences)
	r.Post("/{draftId}/owner/{ownerId}/actions/autoDraft", dra.autoDraft)
	r.Post("/{draftId}/owner/{ownerId}/actions/pick", dra.submitPick)

	// Admin-only: re-run close-draft per-card flow for one user. Used when
	// the original close partially failed (image-gen 500, network blip, etc)
	// and a card needs its roster + image re-persisted. Idempotent. Gated
	// with X-Admin-Key — also called by the daily reconciliation cron.
	r.Post("/{draftId}/owner/{ownerId}/admin/recover-card", requireAdminKey(dra.recoverCard))

	return r
}

// recoverCard is the HTTP wrapper around models.RecoverCardForOwner. Returns
// 200 with a small JSON body on success; 5xx with the underlying error
// message on failure (so admin UI / cron can show a useful message).
func (dra *DraftActionResources) recoverCard(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	ownerId := strings.ToLower(chi.URLParam(r, "ownerId"))
	if draftId == "" || ownerId == "" {
		http.Error(w, "draftId and ownerId required", http.StatusBadRequest)
		return
	}
	if err := models.RecoverCardForOwner(draftId, ownerId); err != nil {
		// RecoverCardForOwner already emits structured ERROR logs for the
		// failing step; we just surface the message here for the caller.
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","event":"admin.recover_card_failed","error":"%v"}`+"\n", draftId, ownerId, err)
		http.Error(w, fmt.Sprintf("recover failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "draftId": draftId, "ownerId": ownerId})
}

// getDraftPreferences returns sort/auto-draft preferences for this owner in the draft.
func (dra *DraftActionResources) getDraftPreferences(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	ownerId := strings.ToLower(chi.URLParam(r, "ownerId"))
	userInfo := models.FetchSortForDrafter(draftId, ownerId)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(userInfo)
}

type patchDraftPreferencesRequest struct {
	AutoDraft *bool `json:"autoDraft"`
}

// patchDraftPreferences allows the owner to turn auto-draft on or off manually.
func (dra *DraftActionResources) patchDraftPreferences(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	ownerId := strings.ToLower(chi.URLParam(r, "ownerId"))

	var req patchDraftPreferencesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid body: %v", err), http.StatusBadRequest)
		return
	}
	if req.AutoDraft == nil {
		http.Error(w, "autoDraft (boolean) is required", http.StatusBadRequest)
		return
	}

	userInfo := models.FetchSortForDrafter(draftId, ownerId)
	userInfo.AutoDraft = *req.AutoDraft
	if !*req.AutoDraft {
		userInfo.NumPicksMissedConsecutive = 0
	}
	if err := models.UpdateSortForDrafter(draftId, ownerId, userInfo); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(userInfo)
}

func (dra *DraftActionResources) autoDraft(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	ownerId := chi.URLParam(r, "ownerId")

	var req AutoDraftRequest
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		fmt.Println("Error decoding request body in autoDraft route: ", err)
		http.Error(w, fmt.Sprintf("Error decoding request body: %v", err), http.StatusBadRequest)
		return
	}

	currentPickNumber := req.CurrentPickNumber
	currentRound := req.CurrentRound

	realTimeDraftInfo, err := models.GetRealTimeDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("autoDraft error (GetRealTimeDraftInfoForDraft): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if realTimeDraftInfo.CurrentPickNumber > currentPickNumber {
		// No-op: user already made the pick; return 200 so Cloud Tasks does not retry
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Pick already completed"))
		return
	}

	userInfo := models.FetchSortForDrafter(draftId, ownerId)

	calculatedPick, err := models.CalculateAutoPickForUser(draftId, ownerId, currentPickNumber, currentRound, realTimeDraftInfo)
	if err != nil {
		fmt.Printf("autoDraft error (CalculateAutoPickForUser): draftId=%s ownerId=%s currentPickNumber=%d currentRound=%d err=%v\n", draftId, ownerId, currentPickNumber, currentRound, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if calculatedPick.PlayerId == "" {
		fmt.Printf("autoDraft error: draftId=%s ownerId=%s no pick calculated (empty PlayerId)\n", draftId, ownerId)
		http.Error(w, "No pick was calculated", http.StatusInternalServerError)
		return
	}

	if userInfo.AutoDraft {
		err = models.ProcessNewPick(draftId, calculatedPick, false)
		if err != nil {
			fmt.Printf("autoDraft error (ProcessNewPick): draftId=%s ownerId=%s calculatedPick=%+v err=%v\n", draftId, ownerId, calculatedPick, err)
			// TRANSIENT failure (stall/blip): tell Cloud Tasks the truth so it
			// re-delivers — the in-process 2s×3 retries are the first line; this
			// is the backstop. Safe: the top-of-handler "pick already completed
			// → no-op 200" guard plus idempotent pick steps (same-slot summary,
			// deduped roster, same-value playerState) make re-delivery harmless.
			// Returning 200 here is what turned a 60s blip into a permanently
			// frozen draft on 2026-06-10 (2024-fast-draft-1381).
			if utils.IsTransientDbErr(err) {
				fmt.Printf(`{"severity":"ERROR","event":"autodraft_transient_will_retry","draftId":"%s","pick":%d,"error":%q}`+"\n", draftId, currentPickNumber, err.Error())
				http.Error(w, "transient failure — retry", http.StatusServiceUnavailable)
				return
			}
			// Non-transient (benign race: pick landed concurrently, validation
			// mismatch) — retrying would fail identically; keep the no-retry 200.
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("Pick processed successfully"))
			return
		}
	} else {
		// Wait until PickEndTime before processing the pick
		now := time.Now().Unix()
		if now < realTimeDraftInfo.PickEndTime {
			waitDuration := time.Duration(realTimeDraftInfo.PickEndTime-now) * time.Second
			time.Sleep(waitDuration)
		}

		// RE-CHECK AFTER THE WAIT (Layer A) — fixes the auto-draft double-count.
		// Cloud Tasks is at-least-once, and because we slept above (holding the
		// request open) the same pick's job can be redelivered. Both copies passed
		// the top-of-handler guard (pick not made yet), both slept, both woke.
		// Without re-reading draft state here, BOTH would bump the miss-counter
		// below — +2 off one timeout, flipping AutoDraft on and (at a snake turn)
		// instantly auto-drafting the user's back-to-back pick. Re-fetch and bail
		// if the pick already advanced, BEFORE touching the counter.
		latest, refErr := models.GetRealTimeDraftInfoForDraft(draftId)
		if refErr != nil {
			fmt.Printf("autoDraft error (re-fetch after wait): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, refErr)
			http.Error(w, refErr.Error(), http.StatusInternalServerError)
			return
		}
		if latest.CurrentPickNumber > currentPickNumber {
			// Pick already made (by the user, or by the first copy of this job) —
			// do NOT increment the miss-counter. 200 so Cloud Tasks stops retrying.
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("Pick already completed"))
			return
		}
		realTimeDraftInfo = latest

		// Re-decide the pick off FRESH state. calculatedPick (above) was computed
		// when the Cloud Task fired — ~2s before PickEndTime (scheduleAutoDraftTask:
		// scheduleTime = pickEndTime - 2) — so a player QUEUED in the final ~2s was
		// ignored and the user got the default/ADP pick instead. We already re-fetched
		// post-wait for the double-count guard above; recompute here so a last-second
		// queue change is honored. CalculateAutoPickForUser is read-only; on any error
		// we keep the original calculatedPick (unchanged behavior).
		if freshPick, ferr := models.CalculateAutoPickForUser(draftId, ownerId, currentPickNumber, currentRound, realTimeDraftInfo); ferr == nil && freshPick != nil && freshPick.PlayerId != "" {
			calculatedPick = freshPick
		}

		// LAYER B: per-pick idempotency key. Re-fetch the sort doc so we see any
		// increment a sibling run already persisted, then count this miss only
		// ONCE per pick number. Even if two runs wake at the same instant and both
		// bump, both write counter=prev+1 for the SAME pick → last-write-wins
		// converges to prev+1, never prev+2. Persist BEFORE ProcessNewPick
		// (unchanged ordering) so the next-pick scheduler goroutine reads the
		// updated counter — preserves the snake-turn instant-auto behavior.
		// (AutoDraft enables after 2 consecutive misses; was 3, bumped to 2 on
		// 2026-04-26 per Richard. Exception: draft slots 1 and 10 — the snake
		// turn-ends that pick back-to-back — get one extra miss (3) per Richard
		// on 2026-06-30, since a single disconnect at the turn is costlier.)
		userInfo = models.FetchSortForDrafter(draftId, ownerId)
		if userInfo.LastMissedPickNum != currentPickNumber {
			userInfo.NumPicksMissedConsecutive++
			userInfo.LastMissedPickNum = currentPickNumber
			if userInfo.NumPicksMissedConsecutive >= models.AutoDraftMissThreshold(draftId, ownerId) {
				userInfo.AutoDraft = true
			}
			if err = models.UpdateSortForDrafter(draftId, ownerId, userInfo); err != nil {
				fmt.Printf("autoDraft warn (UpdateSortForDrafter before ProcessNewPick): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
			}
		}

		// Process the pick (also spawns next-pick scheduling goroutine,
		// which now reads the just-persisted userInfo).
		err = models.ProcessNewPick(draftId, calculatedPick, false)
		if err != nil {
			fmt.Printf("autoDraft error (ProcessNewPick after wait): draftId=%s ownerId=%s calculatedPick=%+v err=%v\n", draftId, ownerId, calculatedPick, err)
			// Same transient-vs-benign split as the AutoDraft branch above.
			if utils.IsTransientDbErr(err) {
				fmt.Printf(`{"severity":"ERROR","event":"autodraft_transient_will_retry","draftId":"%s","pick":%d,"error":%q}`+"\n", draftId, currentPickNumber, err.Error())
				http.Error(w, "transient failure — retry", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("Pick processed successfully"))
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Pick processed successfully"))
}

func (dra *DraftActionResources) submitPick(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	ownerId := chi.URLParam(r, "ownerId")
	ownerId = strings.ToLower(ownerId)

	// Get real-time draft info to validate the pick
	realTimeDraftInfo, err := models.GetRealTimeDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("submitPick error (GetRealTimeDraftInfoForDraft): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Verify it's this user's turn
	if strings.ToLower(realTimeDraftInfo.CurrentDrafter) != ownerId {
		fmt.Printf("submitPick error: draftId=%s ownerId=%s currentDrafter=%s (not your turn)\n", draftId, ownerId, realTimeDraftInfo.CurrentDrafter)
		http.Error(w, "It is not your turn to pick", http.StatusBadRequest)
		return
	}

	// Check if pick time has expired
	if time.Now().Unix() > realTimeDraftInfo.PickEndTime {
		fmt.Printf("submitPick error: draftId=%s ownerId=%s pickEndTime=%d (pick time expired)\n", draftId, ownerId, realTimeDraftInfo.PickEndTime)
		http.Error(w, "The pick time has expired", http.StatusBadRequest)
		return
	}

	// Parse the pick request
	var req ManualPickRequest
	err = json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		fmt.Println("Error decoding request body in submitPick route: ", err)
		http.Error(w, fmt.Sprintf("Error decoding request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.PlayerId == "" {
		http.Error(w, "playerId is required", http.StatusBadRequest)
		return
	}

	// Check if player is already picked
	err = models.CheckIfPlayerIsPickedAlready(draftId, req.PlayerId)
	if err != nil {
		fmt.Printf("submitPick error (CheckIfPlayerIsPickedAlready): draftId=%s ownerId=%s playerId=%s err=%v\n", draftId, ownerId, req.PlayerId, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get draft info to get current pick number and round
	draftInfo, err := models.ReturnDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("submitPick error (ReturnDraftInfoForDraft): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Create PlayerStateInfo from request
	pickInfo := &models.PlayerStateInfo{
		PlayerId:     req.PlayerId,
		DisplayName:  req.DisplayName,
		Team:         req.Team,
		Position:     req.Position,
		OwnerAddress: ownerId,
		PickNum:      draftInfo.CurrentPickNumber,
		Round:        draftInfo.CurrentRound,
	}

	// Process the pick (isUserPick = true for manual picks)
	err = models.ProcessNewPick(draftId, pickInfo, true)
	if err != nil {
		fmt.Printf("submitPick error (ProcessNewPick): draftId=%s ownerId=%s pickInfo=%+v err=%v\n", draftId, ownerId, pickInfo, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Manual pick: exit auto-draft and reset consecutive missed-pick count
	userInfo := models.FetchSortForDrafter(draftId, ownerId)
	userInfo.AutoDraft = false
	userInfo.NumPicksMissedConsecutive = 0
	err = models.UpdateSortForDrafter(draftId, ownerId, userInfo)
	if err != nil {
		// Log error but don't fail the request since the pick was already processed
		fmt.Printf("Error updating sort for drafter after manual pick: %v\n", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	response := map[string]interface{}{
		"message": "Pick submitted successfully",
		"pick":    pickInfo,
	}
	json.NewEncoder(w).Encode(response)
}
