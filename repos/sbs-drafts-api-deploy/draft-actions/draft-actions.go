package draftActions

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
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

	r.Get("/{draftId}/owner/{ownerId}/preferences", dra.getDraftPreferences)
	r.Patch("/{draftId}/owner/{ownerId}/preferences", dra.patchDraftPreferences)
	r.Post("/{draftId}/owner/{ownerId}/actions/autoDraft", dra.autoDraft)
	r.Post("/{draftId}/owner/{ownerId}/actions/pick", dra.submitPick)

	return r
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

		// Process the pick
		err = models.ProcessNewPick(draftId, calculatedPick, false)
		if err != nil {
			fmt.Printf("autoDraft error (ProcessNewPick after wait): draftId=%s ownerId=%s calculatedPick=%+v err=%v\n", draftId, ownerId, calculatedPick, err)
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("Pick processed successfully"))
			return
		}

		// Update SortByObj to reflect missed pick
		userInfo.NumPicksMissedConsecutive++

		// After 2 consecutive timer-expired picks (server auto-pick), enable auto-draft for future picks.
		// Was 3 originally; bumped to 2 (2026-04-26) per Richard — three full timers of waiting was so
		// long in slow drafts that AFK users effectively never auto-drafted.
		if userInfo.NumPicksMissedConsecutive >= 2 {
			userInfo.AutoDraft = true
		}

		// Update the SortByObj in the database
		err = models.UpdateSortForDrafter(draftId, ownerId, userInfo)
		if err != nil {
			fmt.Printf("autoDraft error (UpdateSortForDrafter): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
