package draftActions

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/auth"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

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

	if auth.AuthEnabled() {
		r.With(auth.RequireAutoDraftSecret).Post("/{draftId}/owner/{ownerId}/actions/autoDraft", dra.autoDraft)
		r.With(auth.RequireAdminKey).Post("/{draftId}/owner/{ownerId}/admin/recover-card", dra.recoverCard)
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireServiceKey, auth.RequireWalletMatchesOwner)
			r.Get("/{draftId}/owner/{ownerId}/preferences", dra.getDraftPreferences)
			r.Patch("/{draftId}/owner/{ownerId}/preferences", dra.patchDraftPreferences)
			r.Post("/{draftId}/owner/{ownerId}/actions/pick", dra.submitPick)
		})
		return r
	}

	r.Get("/{draftId}/owner/{ownerId}/preferences", dra.getDraftPreferences)
	r.Patch("/{draftId}/owner/{ownerId}/preferences", dra.patchDraftPreferences)
	r.Post("/{draftId}/owner/{ownerId}/actions/autoDraft", dra.autoDraft)
	r.Post("/{draftId}/owner/{ownerId}/actions/pick", dra.submitPick)
	r.With(auth.RequireAdminKey).Post("/{draftId}/owner/{ownerId}/admin/recover-card", dra.recoverCard)

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

	if userInfo.AutoDraft {
		calculatedPick, err := models.CalculateAutoPickForUser(draftId, ownerId, currentPickNumber, currentRound, realTimeDraftInfo)
		if err != nil {
			if models.IsPickAlreadyProcessed(err) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("Pick already completed"))
				return
			}
			fmt.Printf("autoDraft error (CalculateAutoPickForUser): draftId=%s ownerId=%s currentPickNumber=%d currentRound=%d err=%v\n", draftId, ownerId, currentPickNumber, currentRound, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if calculatedPick.PlayerId == "" {
			fmt.Printf("autoDraft error: draftId=%s ownerId=%s no pick calculated (empty PlayerId)\n", draftId, ownerId)
			http.Error(w, "No pick was calculated", http.StatusInternalServerError)
			return
		}

		err = models.ProcessNewPick(draftId, calculatedPick, false)
		if err != nil {
			if models.IsPickAlreadyProcessed(err) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("Pick already completed"))
				return
			}
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
		// Timer-expiry path: Cloud Task was scheduled ~2s before PickEndTime.
		// Wait out the remaining time in-process, re-check the slot, then pick.
		pickEndTime := realTimeDraftInfo.PickEndTime
		if wait := time.Until(time.Unix(pickEndTime, 0)); wait > 0 {
			fmt.Printf("autoDraft waiting %v until pickEndTime for draftId=%s pick=%d\n", wait, draftId, currentPickNumber)
			time.Sleep(wait)
		}

		realTimeDraftInfo, err = models.GetRealTimeDraftInfoForDraft(draftId)
		if err != nil {
			fmt.Printf("autoDraft error (GetRealTimeDraftInfoForDraft after wait): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if realTimeDraftInfo.CurrentPickNumber > currentPickNumber {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("Pick already completed"))
			return
		}

		calculatedPick, err := models.CalculateAutoPickForUser(draftId, ownerId, currentPickNumber, currentRound, realTimeDraftInfo)
		if err != nil {
			if models.IsPickAlreadyProcessed(err) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("Pick already completed"))
				return
			}
			fmt.Printf("autoDraft error (CalculateAutoPickForUser after wait): draftId=%s ownerId=%s currentPickNumber=%d currentRound=%d err=%v\n", draftId, ownerId, currentPickNumber, currentRound, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if calculatedPick.PlayerId == "" {
			fmt.Printf("autoDraft error: draftId=%s ownerId=%s no pick calculated after wait (empty PlayerId)\n", draftId, ownerId)
			http.Error(w, "No pick was calculated", http.StatusInternalServerError)
			return
		}

		userInfo.NumPicksMissedConsecutive++
		if userInfo.NumPicksMissedConsecutive >= 2 {
			userInfo.AutoDraft = true
		}
		if err := models.UpdateSortForDrafter(draftId, ownerId, userInfo); err != nil {
			fmt.Printf("autoDraft warn (UpdateSortForDrafter before ProcessNewPick): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
		}

		err = models.ProcessNewPick(draftId, calculatedPick, false)
		if err != nil {
			if models.IsPickAlreadyProcessed(err) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("Pick already completed"))
				return
			}
			fmt.Printf("autoDraft error (ProcessNewPick after wait): draftId=%s ownerId=%s calculatedPick=%+v err=%v\n", draftId, ownerId, calculatedPick, err)
			if utils.IsTransientDbErr(err) {
				fmt.Printf(`{"severity":"ERROR","event":"autodraft_transient_will_retry","draftId":"%s","pick":%d,"error":%q}`+"\n", draftId, currentPickNumber, err.Error())
				http.Error(w, "transient failure — retry", http.StatusServiceUnavailable)
				return
			}
			// Non-transient (benign race) — no-retry 200 so Cloud Tasks stops.
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
