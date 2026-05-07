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
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

type StagingResources struct{}

func (sr *StagingResources) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/fill-bots/{speed}", sr.FillBots)
	r.Post("/mint-tokens/{ownerId}", sr.MintTokens)
	r.Post("/cleanup-stale-leagues", sr.CleanupStaleLeagues)
	r.Post("/reset-draft-counter", sr.ResetDraftCounter)
	r.Post("/cleanup-tokens/{ownerId}", sr.CleanupOldTokens)
	r.Post("/skip-draft-counter", sr.SkipDraftCounter)
	r.Post("/fix-counter", sr.FixFilledLeaguesCount)
	r.Post("/clear-all-tokens/{ownerId}", sr.ClearAllTokenLeagues)
	r.Post("/create-special-draft", sr.CreateSpecialDraft)
	r.Post("/join-special-draft", sr.JoinSpecialDraft)
	return r
}

type CreateSpecialDraftRequest struct {
	Type    string   `json:"type"`    // "jackpot" or "hof"
	Wallets []string `json:"wallets"` // exactly 10 wallet addresses
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

	// Read draft tracker to get next draft number
	var counts models.DraftLeagueTracker
	err := utils.Db.ReadDocument("drafts", "draftTracker", &counts)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading draft tracker: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	draftNum := counts.CurrentSlowDraftCount + 1
	draftId := fmt.Sprintf("2025-slow-draft-%d", draftNum)

	// Create the league with the special level
	league := &models.League{
		LeagueId:     draftId,
		DisplayName:  fmt.Sprintf("%s Draft #%d", level, draftNum),
		CurrentUsers: make([]models.LeagueUser, 0),
		NumPlayers:   0,
		MaxPlayers:   10,
		DraftType:    "slow",
		Level:        level,
		IsLocked:     false,
	}

	// Save the empty league first
	err = utils.Db.CreateOrUpdateDocument("drafts", league.LeagueId, league)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error creating league: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	// Add each wallet's token to the league — mint a new token for each
	for _, wallet := range req.Wallets {
		wallet = strings.ToLower(wallet)

		// Mint a fresh token for this wallet
		tokenId := fmt.Sprintf("special-%d-%d", time.Now().UnixMilli(), league.NumPlayers)
		token, err := models.MintDraftTokenInDb(tokenId, wallet)
		if err != nil {
			// Token might already exist, try with a different ID
			tokenId = fmt.Sprintf("special-%d-%d-retry", time.Now().UnixMilli(), league.NumPlayers)
			token, err = models.MintDraftTokenInDb(tokenId, wallet)
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
	err = utils.Db.CreateOrUpdateDocument("drafts", league.LeagueId, league)
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

	// Read the existing league
	var league models.League
	err := utils.Db.ReadDocument("drafts", req.DraftId, &league)
	if err != nil {
		http.Error(w, fmt.Sprintf("League %s not found: %s", req.DraftId, err.Error()), http.StatusNotFound)
		return
	}

	// Check if wallet is already in the league
	for _, u := range league.CurrentUsers {
		if strings.ToLower(u.OwnerId) == wallet {
			// Already in — return success (idempotent)
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
	}

	if league.NumPlayers >= 10 {
		http.Error(w, "League is already full", http.StatusBadRequest)
		return
	}

	// Find an available token for this wallet
	docs, err := utils.Db.Client.Collection("draftTokens").Where("OwnerId", "==", wallet).Where("LeagueId", "==", "").Documents(context.Background()).GetAll()
	if err != nil || len(docs) == 0 {
		http.Error(w, fmt.Sprintf("No available token for wallet %s", wallet), http.StatusBadRequest)
		return
	}

	var token models.DraftToken
	if err := docs[0].DataTo(&token); err != nil {
		http.Error(w, fmt.Sprintf("Error reading token: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	// Update the token
	token.LeagueId = league.LeagueId
	token.DraftType = "slow"
	token.LeagueDisplayName = league.DisplayName
	token.Level = league.Level

	// Add user to league
	league.CurrentUsers = append(league.CurrentUsers, models.LeagueUser{
		OwnerId: wallet,
		TokenId: token.CardId,
	})
	league.NumPlayers++

	// Save token
	err = token.UpdateInUseDraftTokenInDatabase(league.LeagueId)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error updating token: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	// Remove from available pool
	utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", wallet)).Doc(token.CardId).Delete(context.Background())

	// Save updated league
	err = utils.Db.CreateOrUpdateDocument("drafts", league.LeagueId, &league)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error saving league: %s", err.Error()), http.StatusInternalServerError)
		return
	}

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

	timestamp := time.Now().UnixMilli()
	tokens := make([]map[string]interface{}, 0)

	for i := 0; i < count; i++ {
		tokenId := fmt.Sprintf("staging-%d-%d", timestamp, i)
		_, err := models.MintDraftTokenInDb(tokenId, ownerId)
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

			token, err := models.MintDraftTokenInDb(botTokenId, botOwnerId)
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
			cards, err := models.JoinLeagues(bot.ownerId, 1, "paid")
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
