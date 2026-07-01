package staging

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/batchproof"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

type StagingResources struct{}

func (sr *StagingResources) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/fill-bots/{speed}", sr.FillBots)
	r.Post("/add-bots-to-league", sr.AddBotsToLeague)
	r.Post("/mint-tokens/{ownerId}", sr.MintTokens)
	r.Post("/cleanup-stale-leagues", sr.CleanupStaleLeagues)
	r.Post("/reset-draft-counter", sr.ResetDraftCounter)
	r.Post("/cleanup-tokens/{ownerId}", sr.CleanupOldTokens)
	r.Post("/skip-draft-counter", sr.SkipDraftCounter)
	r.Post("/fix-counter", sr.FixFilledLeaguesCount)
	r.Post("/clear-all-tokens/{ownerId}", sr.ClearAllTokenLeagues)
	r.Post("/create-special-draft", sr.CreateSpecialDraft)
	r.Post("/join-special-draft", sr.JoinSpecialDraft)
	r.Post("/swap-special-draft-member", sr.SwapSpecialDraftMember)
	r.Post("/merkle-open-next-round", sr.MerkleOpenNextRound)
	r.Post("/merkle-reset", sr.MerkleReset)
	return r
}

type CreateSpecialDraftRequest struct {
	Type    string   `json:"type"`    // "jackpot" or "hof"
	Wallets []string `json:"wallets"` // exactly 10 wallet addresses
	// RoundId is the queue round this create belongs to. When present it makes
	// creation IDEMPOTENT per round: a marker doc keyed on (type, roundId)
	// resolves every repeated/concurrent create for the same round to the SAME
	// draftId, so a duplicate create can never spawn a second league or duplicate
	// seat tokens. nil = legacy callers → fall back to the old counter path.
	RoundId *int `json:"roundId,omitempty"`
}

// reserveSpecialDraftId atomically resolves the draftId for a special (wheel)
// draft. The slot number comes from the dedicated SpecialDraftCount sequence,
// bumped inside the transaction, so two different rounds can never share a slot
// (the collision that would have let the next winner overwrite an existing
// special draft). When a roundId is supplied a marker doc keyed on
// (type, roundId) records the reserved id, so a repeated/concurrent create for
// the SAME round resolves to the SAME draftId instead of reserving a new slot —
// making creation idempotent per round. Special drafts keep the "2025-slow-draft-N"
// id format so the existing capture/scan paths still pick them up.
func (sr *StagingResources) reserveSpecialDraftId(draftType string, roundId *int) (string, int, error) {
	ctx := context.Background()
	trackerRef := utils.Db.Client.Collection("drafts").Doc("draftTracker")
	var markerRef *firestore.DocumentRef
	if roundId != nil {
		markerRef = utils.Db.Client.Collection("specialDraftRounds").Doc(fmt.Sprintf("%s-%d", draftType, *roundId))
	}

	var draftId string
	var draftNum int
	err := utils.Db.Client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		// Idempotent short-circuit: this round already reserved a draftId.
		if markerRef != nil {
			if m, gerr := tx.Get(markerRef); gerr == nil && m.Exists() {
				data := m.Data()
				if v, ok := data["draftId"].(string); ok && v != "" {
					draftId = v
					if n, ok2 := data["draftNum"].(int64); ok2 {
						draftNum = int(n)
					}
					return nil
				}
			}
		}
		tSnap, gerr := tx.Get(trackerRef)
		if gerr != nil {
			return gerr
		}
		var t models.DraftLeagueTracker
		if derr := tSnap.DataTo(&t); derr != nil {
			return derr
		}
		draftNum = t.SpecialDraftCount + 1
		draftId = fmt.Sprintf("2025-slow-draft-%d", draftNum)
		if serr := tx.Set(trackerRef, map[string]interface{}{"SpecialDraftCount": draftNum}, firestore.MergeAll); serr != nil {
			return serr
		}
		if markerRef != nil {
			if serr := tx.Set(markerRef, map[string]interface{}{"draftId": draftId, "draftNum": draftNum, "type": draftType}); serr != nil {
				return serr
			}
		}
		return nil
	})
	return draftId, draftNum, err
}

// CreateSpecialDraft creates a slow draft league with a specific level (Jackpot/HOF)
// and enters all provided wallets. Called by Firestore trigger when a queue round fills.
func (sr *StagingResources) CreateSpecialDraft(w http.ResponseWriter, r *http.Request) {
	var req CreateSpecialDraftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Type != "jackpot" && req.Type != "hof" {
		http.Error(w, "type must be 'jackpot' or 'hof'", http.StatusBadRequest)
		return
	}

	if len(req.Wallets) < 1 || len(req.Wallets) > 10 {
		http.Error(w, fmt.Sprintf("Expected 1-10 wallets, got %d", len(req.Wallets)), http.StatusBadRequest)
		return
	}

	// Determine the level name for the league
	level := "Jackpot"
	if req.Type == "hof" {
		level = "Hall of Fame"
	}

	// Resolve the draftId IDEMPOTENTLY from the dedicated SpecialDraftCount
	// sequence (NOT the per-100 slow-draft counter, which is for regular 2026-
	// slow drafts). A marker keyed on (type, roundId) makes repeated/concurrent
	// creates for the SAME round resolve to the SAME draftId, and the atomic
	// SpecialDraftCount bump guarantees distinct rounds never share a slot — so a
	// duplicate create can never spawn a second league or duplicate seat tokens.
	draftId, draftNum, rerr := sr.reserveSpecialDraftId(req.Type, req.RoundId)
	if rerr != nil {
		http.Error(w, fmt.Sprintf("Error reserving special draft slot: %s", rerr.Error()), http.StatusInternalServerError)
		return
	}

	// Load the league if it already exists (idempotent re-create), else start a
	// fresh one. NEVER overwrite an existing league's members with an empty list.
	var league *models.League
	var existing models.League
	if rerr := utils.Db.ReadDocument("drafts", draftId, &existing); rerr == nil && existing.LeagueId != "" {
		league = &existing
	} else {
		league = &models.League{
			LeagueId:     draftId,
			DisplayName:  fmt.Sprintf("%s Draft #%d", level, draftNum),
			CurrentUsers: make([]models.LeagueUser, 0),
			NumPlayers:   0,
			MaxPlayers:   10,
			DraftType:    "slow",
			Level:        level,
			IsLocked:     false,
		}
		if err := utils.Db.CreateOrUpdateDocument("drafts", league.LeagueId, league); err != nil {
			http.Error(w, fmt.Sprintf("Error creating league: %s", err.Error()), http.StatusInternalServerError)
			return
		}
	}

	// Add each wallet's token to the league — mint a new token for each
	for _, wallet := range req.Wallets {
		wallet = strings.ToLower(wallet)

		// Idempotent: never seat the same wallet twice in this league. On an
		// idempotent re-create (same round → same draftId) the wallet is already
		// present, so we skip — no duplicate seat token (the orphan bug).
		alreadySeated := false
		for _, u := range league.CurrentUsers {
			if strings.EqualFold(u.OwnerId, wallet) {
				alreadySeated = true
				break
			}
		}
		if alreadySeated {
			continue
		}

		// Mint a fresh token for this wallet. PassType 'free' is load-bearing:
		// it is the stamp the frontend promo gate (promoCreditAllowed) reads, and
		// special wheel drafts must NEVER earn promos (no pick-10 spin, no
		// daily-drafts count, no jackpot draw credit).
		tokenId := fmt.Sprintf("special-%d-%d", time.Now().UnixMilli(), league.NumPlayers)
		token, err := models.MintDraftTokenInDb(tokenId, wallet, "free")
		if err != nil {
			// Token might already exist, try with a different ID
			tokenId = fmt.Sprintf("special-%d-%d-retry", time.Now().UnixMilli(), league.NumPlayers)
			token, err = models.MintDraftTokenInDb(tokenId, wallet, "free")
			if err != nil {
				fmt.Printf("[CreateSpecialDraft] Error minting token for wallet %s: %s\n", wallet, err.Error())
				continue
			}
		}

		// Update the token with league info
		token.LeagueId = league.LeagueId
		token.DraftType = "slow"
		token.LeagueDisplayName = league.DisplayName
		token.Level = level

		// Add user to league
		league.CurrentUsers = append(league.CurrentUsers, models.LeagueUser{
			OwnerId: wallet,
			TokenId: token.CardId,
		})
		league.NumPlayers++

		// Save token
		err = token.UpdateInUseDraftTokenInDatabase(league.LeagueId)
		if err != nil {
			fmt.Printf("[CreateSpecialDraft] Error updating token %s: %s\n", token.CardId, err.Error())
			continue
		}

		// Remove from available pool
		utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", wallet)).Doc(token.CardId).Delete(context.Background())
	}

	// Save updated league with all users
	err := utils.Db.CreateOrUpdateDocument("drafts", league.LeagueId, league)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error saving league: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	// Always update RTDB with current player count (draft room shows filling phase)
	ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", league.LeagueId))
	ref.Set(context.TODO(), map[string]interface{}{"numPlayers": league.NumPlayers})

	// If we got all 10, create the draft state so picking can begin
	if league.NumPlayers == 10 {
		err = models.CreateLeagueDraftStateUponFilling(draftId, "slow")
		if err != nil {
			http.Error(w, fmt.Sprintf("Error creating draft state: %s", err.Error()), http.StatusInternalServerError)
			return
		}
	}

	resp := map[string]interface{}{
		"draftId":    draftId,
		"level":      level,
		"numPlayers": league.NumPlayers,
	}
	data, _ := json.Marshal(resp)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// JoinSpecialDraft adds a single wallet to an existing special draft league.
// Called by Firestore trigger when a new member joins a queue round that already has a draft.
// When the 10th player joins, creates the draft state so picking can begin.
func (sr *StagingResources) JoinSpecialDraft(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DraftId string `json:"draftId"`
		Wallet  string `json:"wallet"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.DraftId == "" || req.Wallet == "" {
		http.Error(w, "draftId and wallet are required", http.StatusBadRequest)
		return
	}

	wallet := strings.ToLower(req.Wallet)

	// Mint the seat token FIRST (outside the league transaction; cleaned up if
	// the join loses). Always a fresh special token — never consume a token from
	// the wallet's existing pool (a wheel winner's paid passes stay untouched;
	// the wheel pass NFT itself is the entry, mirroring CreateSpecialDraft).
	// PassType 'free' is load-bearing: it is the stamp the frontend promo gate
	// (promoCreditAllowed) reads, and special wheel drafts must NEVER earn promos.
	tokenId := fmt.Sprintf("special-%d-%s", time.Now().UnixMilli(), wallet[2:8])
	minted, mintErr := models.MintDraftTokenInDb(tokenId, wallet, "free")
	if mintErr != nil {
		tokenId = fmt.Sprintf("special-%d-%s-retry", time.Now().UnixMilli(), wallet[2:8])
		minted, mintErr = models.MintDraftTokenInDb(tokenId, wallet, "free")
		if mintErr != nil {
			http.Error(w, fmt.Sprintf("Mint failed for wallet %s: %s", wallet, mintErr.Error()), http.StatusInternalServerError)
			return
		}
	}
	token := *minted

	// Seat the wallet inside a TRANSACTION — two wheel winners joining in the
	// same instant must not lose each other's seat (read-modify-write races).
	var league models.League
	alreadyJoined := false
	leagueRef := utils.Db.Client.Collection("drafts").Doc(req.DraftId)
	err := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(leagueRef)
		if err != nil {
			return fmt.Errorf("league %s not found: %w", req.DraftId, err)
		}
		var l models.League
		if err := doc.DataTo(&l); err != nil {
			return err
		}
		alreadyJoined = false
		for _, u := range l.CurrentUsers {
			if strings.ToLower(u.OwnerId) == wallet {
				alreadyJoined = true
				league = l
				return nil
			}
		}
		if l.NumPlayers >= 10 {
			return fmt.Errorf("league is already full")
		}
		l.CurrentUsers = append(l.CurrentUsers, models.LeagueUser{
			OwnerId: wallet,
			TokenId: token.CardId,
		})
		l.NumPlayers++
		league = l
		return tx.Set(leagueRef, &l)
	})
	if err != nil {
		// The seat didn't land — remove the pre-minted token so it can't linger
		// as a spendable pass.
		utils.Db.DeleteDocument(utils.GetDraftTokenCollectionName(), token.CardId)
		utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/validDraftTokens", wallet), token.CardId)
		if strings.Contains(err.Error(), "already full") {
			http.Error(w, "League is already full", http.StatusBadRequest)
		} else if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, fmt.Sprintf("Error joining league: %s", err.Error()), http.StatusInternalServerError)
		}
		return
	}

	if alreadyJoined {
		// Idempotent: seat already held — drop the redundant minted token.
		utils.Db.DeleteDocument(utils.GetDraftTokenCollectionName(), token.CardId)
		utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/validDraftTokens", wallet), token.CardId)
		resp := map[string]interface{}{
			"draftId":    req.DraftId,
			"numPlayers": league.NumPlayers,
			"status":     "already_joined",
		}
		data, _ := json.Marshal(resp)
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
		return
	}

	// Update the token with league info
	token.LeagueId = league.LeagueId
	token.DraftType = "slow"
	token.LeagueDisplayName = league.DisplayName
	token.Level = league.Level

	// Save token
	err = token.UpdateInUseDraftTokenInDatabase(league.LeagueId)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error updating token: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	// Remove from available pool
	utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", wallet)).Doc(token.CardId).Delete(context.Background())

	// Update RTDB with current player count
	ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", league.LeagueId))
	ref.Set(context.TODO(), map[string]interface{}{"numPlayers": league.NumPlayers})

	// If we hit 10, create the draft state so picking can begin
	if league.NumPlayers == 10 {
		err = models.CreateLeagueDraftStateUponFilling(req.DraftId, "slow")
		if err != nil {
			fmt.Printf("[JoinSpecialDraft] Error creating draft state for %s: %s\n", req.DraftId, err.Error())
		}
	}

	resp := map[string]interface{}{
		"draftId":    req.DraftId,
		"numPlayers": league.NumPlayers,
		"status":     "joined",
	}
	data, _ := json.Marshal(resp)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// SwapSpecialDraftMember atomically hands a seat in a FILLING special draft from
// the seller of a wheel-won pass to its marketplace buyer. The seller's special
// token is destroyed (a sold pass must never return to their pool); the buyer
// gets a fresh 'free'-stamped token in the same seat. NumPlayers is unchanged,
// so this can never race the fill threshold. Rejected once the draft is full —
// seats lock at 10/10.
func (sr *StagingResources) SwapSpecialDraftMember(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DraftId    string `json:"draftId"`
		FromWallet string `json:"fromWallet"`
		ToWallet   string `json:"toWallet"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.DraftId == "" || req.FromWallet == "" || req.ToWallet == "" {
		http.Error(w, "draftId, fromWallet and toWallet are required", http.StatusBadRequest)
		return
	}
	fromWallet := strings.ToLower(req.FromWallet)
	toWallet := strings.ToLower(req.ToWallet)

	var league models.League
	err := utils.Db.ReadDocument("drafts", req.DraftId, &league)
	if err != nil {
		http.Error(w, fmt.Sprintf("League %s not found: %s", req.DraftId, err.Error()), http.StatusNotFound)
		return
	}
	if league.Level != "Jackpot" && league.Level != "Hall of Fame" {
		http.Error(w, "Not a special draft league", http.StatusBadRequest)
		return
	}

	// Mint the buyer's token first — if anything below fails it's cleaned up,
	// and the league is only ever touched inside the transaction.
	// PassType 'free': special-draft tokens never earn promos (frontend gate).
	newTokenId := fmt.Sprintf("special-%d-swap", time.Now().UnixMilli())
	newToken, mintErr := models.MintDraftTokenInDb(newTokenId, toWallet, "free")
	if mintErr != nil {
		newTokenId = fmt.Sprintf("special-%d-swap-retry", time.Now().UnixMilli())
		newToken, mintErr = models.MintDraftTokenInDb(newTokenId, toWallet, "free")
		if mintErr != nil {
			http.Error(w, fmt.Sprintf("Mint failed for buyer %s: %s", toWallet, mintErr.Error()), http.StatusInternalServerError)
			return
		}
	}
	newToken.LeagueId = league.LeagueId
	newToken.DraftType = "slow"
	newToken.LeagueDisplayName = league.DisplayName
	newToken.Level = league.Level

	// Replace the seat in a TRANSACTION — a concurrent join must not be lost,
	// and a fill that lands first must win (seat locks at 10/10).
	oldTokenId := ""
	alreadySwapped := false
	leagueRef := utils.Db.Client.Collection("drafts").Doc(req.DraftId)
	err = utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(leagueRef)
		if err != nil {
			return err
		}
		var l models.League
		if err := doc.DataTo(&l); err != nil {
			return err
		}
		alreadySwapped = false
		for _, u := range l.CurrentUsers {
			if strings.EqualFold(u.OwnerId, toWallet) {
				alreadySwapped = true
				league = l
				return nil
			}
		}
		if l.NumPlayers >= 10 {
			return fmt.Errorf("draft already filled")
		}
		seatIdx := -1
		for i, u := range l.CurrentUsers {
			if strings.EqualFold(u.OwnerId, fromWallet) {
				oldTokenId = u.TokenId
				seatIdx = i
				break
			}
		}
		if seatIdx == -1 {
			return fmt.Errorf("wallet %s holds no seat", fromWallet)
		}
		l.CurrentUsers[seatIdx] = models.LeagueUser{OwnerId: toWallet, TokenId: newToken.CardId}
		league = l
		return tx.Set(leagueRef, &l)
	})
	if err != nil {
		// Swap didn't land — remove the pre-minted buyer token.
		utils.Db.DeleteDocument(utils.GetDraftTokenCollectionName(), newToken.CardId)
		utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/validDraftTokens", toWallet), newToken.CardId)
		if strings.Contains(err.Error(), "already filled") {
			http.Error(w, "Draft already filled — the pass is locked to its current owner", http.StatusConflict)
		} else if strings.Contains(err.Error(), "holds no seat") {
			http.Error(w, fmt.Sprintf("Wallet %s holds no seat in league %s", fromWallet, req.DraftId), http.StatusNotFound)
		} else {
			http.Error(w, fmt.Sprintf("Error swapping seat: %s", err.Error()), http.StatusInternalServerError)
		}
		return
	}

	if alreadySwapped {
		utils.Db.DeleteDocument(utils.GetDraftTokenCollectionName(), newToken.CardId)
		utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/validDraftTokens", toWallet), newToken.CardId)
		resp := map[string]interface{}{"draftId": req.DraftId, "numPlayers": league.NumPlayers, "status": "already_swapped"}
		data, _ := json.Marshal(resp)
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
		return
	}

	if err := newToken.UpdateInUseDraftTokenInDatabase(league.LeagueId); err != nil {
		fmt.Printf("[SwapSpecialDraftMember] Error updating buyer token %s: %s\n", newToken.CardId, err.Error())
	}
	utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", toWallet)).Doc(newToken.CardId).Delete(context.Background())

	// Destroy the seller's special token everywhere — it must NOT reappear as a
	// spendable pass (this is a sale, not a leave).
	if oldTokenId != "" {
		utils.Db.DeleteDocument(utils.GetDraftTokenCollectionName(), oldTokenId)
		utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/usedDraftTokens", fromWallet), oldTokenId)
		utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/validDraftTokens", fromWallet), oldTokenId)
		utils.Db.DeleteDocument(fmt.Sprintf("drafts/%s/cards", league.LeagueId), oldTokenId)
	}

	// Nudge the room: numPlayers unchanged, but the write pings RTDB listeners
	// so the lobby re-resolves identities and shows the buyer immediately.
	ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", league.LeagueId))
	ref.Set(context.TODO(), map[string]interface{}{"numPlayers": league.NumPlayers})

	resp := map[string]interface{}{
		"draftId":    req.DraftId,
		"numPlayers": league.NumPlayers,
		"status":     "swapped",
		"newTokenId": newToken.CardId,
	}
	data, _ := json.Marshal(resp)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// MintTokens creates draft tokens for a user in the database.
// Usage: POST /staging/mint-tokens/{ownerId}?count=5
func (sr *StagingResources) MintTokens(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		http.Error(w, "ownerId is required", http.StatusBadRequest)
		return
	}

	countStr := r.URL.Query().Get("count")
	count := 5
	if countStr != "" {
		if c, err := strconv.Atoi(countStr); err == nil && c > 0 && c <= 50 {
			count = c
		}
	}

	// Ensure owner doc exists
	_, err := models.ReturnOwnerObjectById(ownerId)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error creating owner: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	// passType ('paid'|'free') lets us stock a test wallet with either kind of
	// pass (e.g. ?passType=free). Defaults to paid in MintDraftTokenInDb.
	passType := r.URL.Query().Get("passType")

	timestamp := time.Now().UnixMilli()
	tokens := make([]map[string]interface{}, 0)

	for i := 0; i < count; i++ {
		tokenId := fmt.Sprintf("staging-%d-%d", timestamp, i)
		_, err := models.MintDraftTokenInDb(tokenId, ownerId, passType)
		if err != nil {
			http.Error(w, fmt.Sprintf("Error minting token %d: %s", i, err.Error()), http.StatusInternalServerError)
			return
		}
		tokens = append(tokens, map[string]interface{}{
			"tokenId": tokenId,
			"ownerId": ownerId,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tokensCreated": len(tokens),
		"tokens":        tokens,
	})
}

type botSetup struct {
	ownerId string
	tokenId string
	token   *models.DraftToken
}

func (sr *StagingResources) FillBots(w http.ResponseWriter, r *http.Request) {
	speed := chi.URLParam(r, "speed")
	if speed == "" {
		speed = "fast"
	}

	countStr := r.URL.Query().Get("count")
	count := 9
	if countStr != "" {
		if c, err := strconv.Atoi(countStr); err == nil && c > 0 && c <= 9 {
			count = c
		}
	}

	// If leagueId is provided, add bots directly to that league
	leagueId := r.URL.Query().Get("leagueId")

	timestamp := time.Now().UnixMilli()

	// Step 1: Create all bot owners + mint tokens IN PARALLEL
	bots := make([]botSetup, count)
	var wg sync.WaitGroup
	errs := make([]error, count)

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			botOwnerId := fmt.Sprintf("bot-%s-%d-%d", speed, timestamp, idx)
			botTokenId := fmt.Sprintf("bot-token-%d-%d", timestamp, idx)

			_, err := models.ReturnOwnerObjectById(botOwnerId)
			if err != nil {
				errs[idx] = fmt.Errorf("error creating bot owner %d: %s", idx, err.Error())
				return
			}

			token, err := models.MintDraftTokenInDb(botTokenId, botOwnerId, "paid")
			if err != nil {
				errs[idx] = fmt.Errorf("error minting bot token %d: %s", idx, err.Error())
				return
			}

			bots[idx] = botSetup{ownerId: botOwnerId, tokenId: botTokenId, token: token}
		}(i)
	}
	wg.Wait()
	fmt.Printf("All %d bot owners + tokens created in parallel\n", count)

	for _, e := range errs {
		if e != nil {
			http.Error(w, e.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Step 2: Join bots to league — first bot searches, rest go direct
	results := make([]map[string]interface{}, 0)
	discoveredLeagueId := ""
	draftNumForDirect := -1

	for i := 0; i < count; i++ {
		bot := bots[i]
		var joinedLeagueId string

		if leagueId != "" {
			// leagueId was provided — directly update the league document
			leagueRef := utils.Db.Client.Collection("drafts").Doc(leagueId)
			err := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
				doc, err := tx.Get(leagueRef)
				if err != nil {
					return err
				}
				var league models.League
				err = doc.DataTo(&league)
				if err != nil {
					return err
				}
				if league.NumPlayers >= 10 {
					return fmt.Errorf("league is full")
				}
				league.CurrentUsers = append(league.CurrentUsers, models.LeagueUser{
					OwnerId: bot.ownerId,
					TokenId: bot.tokenId,
				})
				league.NumPlayers++
				return tx.Set(leagueRef, &league)
			})
			if err != nil {
				http.Error(w, fmt.Sprintf("Error adding bot %d to league %s: %s", i, leagueId, err.Error()), http.StatusInternalServerError)
				return
			}
			joinedLeagueId = leagueId

			// Update token
			bot.token.LeagueId = leagueId
			bot.token.DraftType = speed
			bot.token.UpdateInUseDraftTokenInDatabase(leagueId)

			// Check if league is now full (10/10) — trigger draft state creation
			var checkLeague models.League
			utils.Db.ReadDocument("drafts", leagueId, &checkLeague)
			if checkLeague.NumPlayers == 10 {
				fmt.Printf("[fill-bots] League %s reached 10 players, creating draft state\n", leagueId)
				err := models.CreateLeagueDraftStateUponFilling(leagueId, speed)
				if err != nil {
					fmt.Printf("[fill-bots] ERROR creating draft state for %s: %s\n", leagueId, err.Error())
				}
			} else {
				// Update RTDB with player count
				ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", leagueId))
				ref.Set(context.TODO(), map[string]interface{}{"numPlayers": checkLeague.NumPlayers})
			}
		} else if draftNumForDirect >= 0 {
			// Bots 1-8: skip JoinLeagues, call AddCardToLeague directly
			_, err := models.AddCardToLeague(bot.token, draftNumForDirect, speed)
			if err != nil {
				http.Error(w, fmt.Sprintf("Error adding bot %d to league: %s", i, err.Error()), http.StatusInternalServerError)
				return
			}
			joinedLeagueId = discoveredLeagueId
		} else {
			// Bot 0: expensive search to find the league
			cards, err := models.JoinLeagues(bot.ownerId, 1, "paid", "paid")
			if err != nil {
				http.Error(w, fmt.Sprintf("Error joining league for bot %d: %s", i, err.Error()), http.StatusInternalServerError)
				return
			}
			if len(cards) > 0 {
				joinedLeagueId = cards[0].LeagueId
				discoveredLeagueId = joinedLeagueId
				// Extract draft number: "2025-fast-draft-42" → pass 41 (AddCardToLeague does +1)
				parts := strings.Split(joinedLeagueId, "-")
				if len(parts) > 0 {
					if num, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
						draftNumForDirect = num - 1
					}
				}
			}
		}

		fmt.Printf("Bot %d/%d joined league %s\n", i+1, count, joinedLeagueId)
		results = append(results, map[string]interface{}{
			"botOwnerId": bot.ownerId,
			"botTokenId": bot.tokenId,
			"leagueId":   joinedLeagueId,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"botsAdded": len(results),
		"bots":      results,
	})
}

// AddBotsToLeagueRequest is the body for /staging/add-bots-to-league.
type AddBotsToLeagueRequest struct {
	LeagueId string   `json:"leagueId"`
	Speed    string   `json:"speed"`
	OwnerIds []string `json:"ownerIds"`
}

// AddBotsToLeague joins pre-created house "bot" wallets — each already holding a
// minted FREE draft pass — to a SPECIFIC league. It reuses the EXACT join +
// fill-trigger from FillBots' leagueId branch, but sources the bots from the
// provided pool instead of minting throwaway paid bots inline. This is what lets
// a bot's real on-chain free pass reveal into a real team after the draft.
//
// Purely additive + staging-only: it never touches an existing endpoint, only
// the one target league passed in, and only bots that hold an unused free pass.
func (sr *StagingResources) AddBotsToLeague(w http.ResponseWriter, r *http.Request) {
	var req AddBotsToLeagueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.LeagueId == "" {
		http.Error(w, "leagueId is required", http.StatusBadRequest)
		return
	}
	if len(req.OwnerIds) == 0 {
		http.Error(w, "ownerIds is required", http.StatusBadRequest)
		return
	}
	speed := req.Speed
	if speed == "" {
		speed = "fast"
	}

	results := make([]map[string]interface{}, 0)
	for _, ownerId := range req.OwnerIds {
		// Locate this bot's available FREE pass (one not already in a league).
		userTokens, err := models.ReturnAllDraftTokensForOwner(ownerId)
		if err != nil {
			results = append(results, map[string]interface{}{"ownerId": ownerId, "error": fmt.Sprintf("token lookup failed: %s", err.Error())})
			continue
		}
		var token *models.DraftToken
		for i := range userTokens.Available {
			t := userTokens.Available[i]
			if strings.EqualFold(t.PassType, "free") && t.LeagueId == "" {
				token = &userTokens.Available[i]
				break
			}
		}
		if token == nil {
			results = append(results, map[string]interface{}{"ownerId": ownerId, "error": "no available free pass"})
			continue
		}

		// Join transaction — identical to FillBots' leagueId branch.
		leagueRef := utils.Db.Client.Collection("drafts").Doc(req.LeagueId)
		txErr := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
			doc, err := tx.Get(leagueRef)
			if err != nil {
				return err
			}
			var league models.League
			if err := doc.DataTo(&league); err != nil {
				return err
			}
			if league.NumPlayers >= 10 {
				return fmt.Errorf("league is full")
			}
			league.CurrentUsers = append(league.CurrentUsers, models.LeagueUser{
				OwnerId: ownerId,
				TokenId: token.CardId,
			})
			league.NumPlayers++
			return tx.Set(leagueRef, &league)
		})
		if txErr != nil {
			results = append(results, map[string]interface{}{"ownerId": ownerId, "error": fmt.Sprintf("join failed: %s", txErr.Error())})
			continue
		}

		// Move the token valid -> used, stamped to this league.
		token.LeagueId = req.LeagueId
		token.DraftType = speed
		if err := token.UpdateInUseDraftTokenInDatabase(req.LeagueId); err != nil {
			fmt.Printf("[add-bots-to-league] token in-use update failed for %s: %s\n", ownerId, err.Error())
		}

		// Fill-trigger — identical to FillBots.
		var checkLeague models.League
		utils.Db.ReadDocument("drafts", req.LeagueId, &checkLeague)
		if checkLeague.NumPlayers == 10 {
			fmt.Printf("[add-bots-to-league] League %s reached 10 players, creating draft state\n", req.LeagueId)
			if err := models.CreateLeagueDraftStateUponFilling(req.LeagueId, speed); err != nil {
				fmt.Printf("[add-bots-to-league] ERROR creating draft state for %s: %s\n", req.LeagueId, err.Error())
			}
		} else {
			ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", req.LeagueId))
			ref.Set(context.TODO(), map[string]interface{}{"numPlayers": checkLeague.NumPlayers})
		}

		fmt.Printf("[add-bots-to-league] bot %s joined league %s with token %s\n", ownerId, req.LeagueId, token.CardId)
		results = append(results, map[string]interface{}{
			"ownerId":  ownerId,
			"tokenId":  token.CardId,
			"leagueId": req.LeagueId,
			"joined":   true,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"botsAdded": len(results),
		"results":   results,
	})
}

// CleanupStaleLeagues deletes unfilled leagues (< 10 players) and advances
// the draft counter past them so bots don't waste time iterating stale data.
// Usage: POST /staging/cleanup-stale-leagues
func (sr *StagingResources) CleanupStaleLeagues(w http.ResponseWriter, r *http.Request) {
	var tracker models.DraftLeagueTracker
	err := utils.Db.ReadDocument("drafts", "draftTracker", &tracker)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	deleted := 0
	skipped := 0
	startNum := tracker.FilledLeaguesCount + 1

	// Scan forward from the last filled league looking for stale unfilled ones
	consecutiveNotFound := 0
	for num := startNum; consecutiveNotFound < 5; num++ {
		draftId := fmt.Sprintf("2025-fast-draft-%d", num)
		var league models.League
		err := utils.Db.ReadDocument("drafts", draftId, &league)
		if err != nil {
			consecutiveNotFound++
			continue
		}
		consecutiveNotFound = 0

		if league.NumPlayers >= 10 {
			// Already filled — skip
			skipped++
			continue
		}

		// Unfilled league — return bot tokens to available pool and delete
		for _, user := range league.CurrentUsers {
			if strings.HasPrefix(user.OwnerId, "bot-") {
				// Delete bot's used token and league assignment
				utils.Db.Client.Collection("draftTokens").Doc(user.TokenId).Delete(context.Background())
			}
		}

		// Delete league state subcollections if they exist
		stateDocs, _ := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Documents(context.Background()).GetAll()
		for _, doc := range stateDocs {
			doc.Ref.Delete(context.Background())
		}

		// Delete the league document itself
		utils.Db.Client.Collection("drafts").Doc(draftId).Delete(context.Background())

		// Clean up RTDB entry
		ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", draftId))
		ref.Delete(context.Background())

		deleted++
		fmt.Printf("Deleted stale league %s (%d/10 players)\n", draftId, league.NumPlayers)
	}

	// Also check slow drafts
	for num := 1; ; num++ {
		draftId := fmt.Sprintf("2025-slow-draft-%d", num)
		var league models.League
		err := utils.Db.ReadDocument("drafts", draftId, &league)
		if err != nil {
			break // No more slow drafts
		}
		if league.NumPlayers >= 10 {
			continue
		}
		for _, user := range league.CurrentUsers {
			if strings.HasPrefix(user.OwnerId, "bot-") {
				utils.Db.Client.Collection("draftTokens").Doc(user.TokenId).Delete(context.Background())
			}
		}
		stateDocs, _ := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Documents(context.Background()).GetAll()
		for _, doc := range stateDocs {
			doc.Ref.Delete(context.Background())
		}
		utils.Db.Client.Collection("drafts").Doc(draftId).Delete(context.Background())
		ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", draftId))
		ref.Delete(context.Background())
		deleted++
		fmt.Printf("Deleted stale slow league %s (%d/10 players)\n", draftId, league.NumPlayers)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deletedLeagues": deleted,
		"skippedFilled":  skipped,
		"scannedFrom":    startNum,
	})
}

// ResetDraftCounter deletes ALL old league documents from Firestore and resets
// the draft tracker to 0. Next draft will be League #1.
// Only deletes the league doc itself (not subcollections) for speed.
// Usage: POST /staging/reset-draft-counter
func (sr *StagingResources) ResetDraftCounter(w http.ResponseWriter, r *http.Request) {
	deleted := 0

	// Delete all fast draft league documents AND their subcollections
	var wg sync.WaitGroup
	var mu sync.Mutex
	ticket := make(chan struct{}, 20) // limit concurrent deletes

	// Helper to delete a draft and all its state subcollections
	deleteDraft := func(draftId string) {
		// Delete state subcollections first
		stateDocs := []string{"info", "summary", "playerState", "rosters", "connectionList", "sortOrders"}
		for _, doc := range stateDocs {
			utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Doc(doc).Delete(context.Background())
		}
		// Delete any cards subcollection docs
		cardDocs, _ := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/cards", draftId)).Documents(context.Background()).GetAll()
		for _, cd := range cardDocs {
			cd.Ref.Delete(context.Background())
		}
		// Delete the league document itself
		_, err := utils.Db.Client.Collection("drafts").Doc(draftId).Delete(context.Background())
		if err == nil {
			mu.Lock()
			deleted++
			mu.Unlock()
		}
		// Also clean RTDB
		ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", draftId))
		ref.Delete(context.Background())
	}

	for num := 1; num <= 2000; num++ {
		ticket <- struct{}{}
		wg.Add(1)
		go func(n int) {
			defer func() { <-ticket; wg.Done() }()
			deleteDraft(fmt.Sprintf("2025-fast-draft-%d", n))
		}(num)
	}

	// Delete slow draft leagues too
	for num := 1; num <= 100; num++ {
		ticket <- struct{}{}
		wg.Add(1)
		go func(n int) {
			defer func() { <-ticket; wg.Done() }()
			deleteDraft(fmt.Sprintf("2025-slow-draft-%d", n))
		}(num)
	}

	wg.Wait()

	// Reset tracker to 0
	tracker := models.DraftLeagueTracker{
		CurrentLiveDraftCount: 0,
		CurrentSlowDraftCount: 0,
		FilledLeaguesCount:    0,
		HofLeagueIds:          []int{},
		JackpotLeagueIds:      []int{},
	}

	err := utils.Db.CreateOrUpdateDocument("drafts", "draftTracker", &tracker)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error resetting draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "reset",
		"deletedLeagues": deleted,
		"message":        "All leagues deleted and counter reset to 0. Next draft will be League #1.",
	})
}

// SkipDraftCounter advances the counter past all existing leagues.
// Usage: POST /staging/skip-draft-counter?to=2000
func (sr *StagingResources) SkipDraftCounter(w http.ResponseWriter, r *http.Request) {
	toStr := r.URL.Query().Get("to")
	to := 2000
	if toStr != "" {
		if n, err := strconv.Atoi(toStr); err == nil && n > 0 {
			to = n
		}
	}

	var tracker models.DraftLeagueTracker
	err := utils.Db.ReadDocument("drafts", "draftTracker", &tracker)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	tracker.CurrentLiveDraftCount = to
	tracker.FilledLeaguesCount = to
	tracker.HofLeagueIds = []int{}
	tracker.JackpotLeagueIds = []int{}

	err = utils.Db.CreateOrUpdateDocument("drafts", "draftTracker", &tracker)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error updating draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "skipped",
		"message": fmt.Sprintf("Draft counter advanced to %d. Next draft will be League #%d.", to, to+1),
	})
}

// FixFilledLeaguesCount sets filledLeaguesCount (and CurrentLiveDraftCount) to the
// given value WITHOUT resetting the batch HOF/Jackpot distribution.
// Usage: POST /staging/fix-counter?to=22
func (sr *StagingResources) FixFilledLeaguesCount(w http.ResponseWriter, r *http.Request) {
	toStr := r.URL.Query().Get("to")
	if toStr == "" {
		http.Error(w, "?to= parameter is required", http.StatusBadRequest)
		return
	}
	to, err := strconv.Atoi(toStr)
	if err != nil || to < 0 {
		http.Error(w, "?to= must be a non-negative integer", http.StatusBadRequest)
		return
	}

	var tracker models.DraftLeagueTracker
	err = utils.Db.ReadDocument("drafts", "draftTracker", &tracker)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	old := tracker.FilledLeaguesCount
	tracker.CurrentLiveDraftCount = to
	tracker.FilledLeaguesCount = to
	// NOTE: BatchStart, HofLeagueIds, JackpotLeagueIds, BatchHofHitCount, BatchJackpotHit are NOT changed

	err = utils.Db.CreateOrUpdateDocument("drafts", "draftTracker", &tracker)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error updating draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "fixed",
		"message": fmt.Sprintf("FilledLeaguesCount changed from %d to %d. Batch HOF/Jackpot distribution unchanged.", old, to),
	})
}

// CleanupOldTokens deletes old draft tokens from a user's wallet, keeping only
// tokens linked to recent leagues (1-20) and available (unused) tokens.
// Usage: POST /staging/cleanup-tokens/{ownerId}?keep=8
func (sr *StagingResources) CleanupOldTokens(w http.ResponseWriter, r *http.Request) {
	ownerId := strings.ToLower(chi.URLParam(r, "ownerId"))
	if ownerId == "" {
		http.Error(w, "ownerId is required", http.StatusBadRequest)
		return
	}

	keepStr := r.URL.Query().Get("keep")
	keepMax := 20
	if keepStr != "" {
		if n, err := strconv.Atoi(keepStr); err == nil && n > 0 {
			keepMax = n
		}
	}

	// Get all tokens for this owner
	data, err := utils.Db.Client.Collection("draftTokens").Where("OwnerId", "==", ownerId).Documents(context.Background()).GetAll()
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading tokens: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	deleted := 0
	kept := 0

	for _, doc := range data {
		var token models.DraftToken
		doc.DataTo(&token)

		// Keep tokens with no league (available/unused)
		if token.LeagueId == "" {
			kept++
			continue
		}

		// Keep tokens linked to recent leagues (fast-draft-1 through fast-draft-{keepMax})
		keepIt := false
		parts := strings.Split(token.LeagueId, "-")
		if len(parts) > 0 {
			if num, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
				if num >= 1 && num <= keepMax {
					keepIt = true
				}
			}
		}

		if keepIt {
			kept++
			continue
		}

		// Delete old token
		utils.Db.Client.Collection("draftTokens").Doc(token.CardId).Delete(context.Background())
		// Also remove from usedDraftTokens
		utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).Doc(token.CardId).Delete(context.Background())
		deleted++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deleted": deleted,
		"kept":    kept,
		"ownerId": ownerId,
	})
}

// ClearAllTokenLeagues removes leagueId from ALL tokens for an owner,
// making them all available again. Use after reset-draft-counter to fully clean up.
// Usage: POST /staging/clear-all-tokens/{ownerId}
func (sr *StagingResources) ClearAllTokenLeagues(w http.ResponseWriter, r *http.Request) {
	ownerId := strings.ToLower(chi.URLParam(r, "ownerId"))
	if ownerId == "" {
		http.Error(w, "ownerId is required", http.StatusBadRequest)
		return
	}

	data, err := utils.Db.Client.Collection("draftTokens").Where("OwnerId", "==", ownerId).Documents(context.Background()).GetAll()
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading tokens: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	cleared := 0
	for _, doc := range data {
		var token models.DraftToken
		doc.DataTo(&token)
		if token.LeagueId != "" {
			token.LeagueId = ""
			token.LeagueDisplayName = ""
			token.DraftType = ""
			utils.Db.Client.Collection("draftTokens").Doc(token.CardId).Set(context.Background(), &token)
			// Also clear from usedDraftTokens subcollection
			utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).Doc(token.CardId).Delete(context.Background())
			cleared++
		}
	}

	// Also clear any validDraftTokens that have a leagueId
	validDocs, _ := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	for _, doc := range validDocs {
		var token models.DraftToken
		doc.DataTo(&token)
		if token.LeagueId != "" {
			token.LeagueId = ""
			token.LeagueDisplayName = ""
			token.DraftType = ""
			doc.Ref.Set(context.Background(), &token)
			cleared++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cleared": cleared,
		"total":   len(data),
		"ownerId": ownerId,
	})
}


// MerkleOpenNextRound is a staging-only admin trigger that drives the
// next vrf-commit-merkle round through open → fulfilled → merkleCommitted.
// Idempotent. Returns the round number that was opened.
//
// Body (optional): { "firstBatchNumber": int }
//   firstBatchNumber is the legacy batch number this round will eventually
//   start at. Defaults to 0 (sentinel).
func (sr *StagingResources) MerkleOpenNextRound(w http.ResponseWriter, r *http.Request) {
	mgr := batchproof.Default()
	if mgr == nil {
		http.Error(w, "batchproof manager not initialized", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		FirstBatchNumber int `json:"firstBatchNumber"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	roundNumber, err := mgr.PreOpenNextMerkleRound(ctx, req.FirstBatchNumber)
	if err != nil {
		http.Error(w, fmt.Sprintf("PreOpenNextMerkleRound: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":               true,
		"roundNumber":      roundNumber,
		"firstBatchNumber": req.FirstBatchNumber,
	})
}

// MerkleReset wipes the merkle round state + all merkle_rounds docs so a
// fresh first round can be opened. Staging-only — destructive for any
// in-progress round. Use when the cutover got into a weird state during
// testing (e.g. a failed open left orphan state pointers).
func (sr *StagingResources) MerkleReset(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	// Delete all merkle_rounds/{N} docs
	iter := utils.Db.Client.Collection("merkle_rounds").Documents(ctx)
	deletedRounds := 0
	for {
		snap, err := iter.Next()
		if err != nil {
			break
		}
		_, _ = snap.Ref.Delete(ctx)
		deletedRounds++
	}

	// Delete the round-state pointer
	_, _ = utils.Db.Client.Collection("system_config").Doc("merkleRoundState").Delete(ctx)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":            true,
		"deletedRounds": deletedRounds,
	})
}
