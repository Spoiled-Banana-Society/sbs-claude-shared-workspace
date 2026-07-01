package models

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type RealTimeDraftInfo struct {
	CurrentDrafter    string          `json:"currentDrafter"`
	CurrentPickNumber int             `json:"pickNumber"`
	CurrentRound      int             `json:"roundNum"`
	PickInRound       int             `json:"pickInRound"`
	PickEndTime       int64           `json:"pickEndTime"`
	PickStartTime     int64           `json:"pickStartTime"` // Unix when current pick's timer started (wall clock)
	PickLength        int64           `json:"pickLength"`
	DraftStartTime    int64           `json:"draftStartTime"` // Unix timestamp when draft starts
	LastPick          PlayerStateInfo `json:"lastPick"`
	IsDraftComplete   bool            `json:"isDraftComplete"`
	IsDraftClosed     bool            `json:"isDraftClosed"`
	// Draft type ("Pro"/"Hall of Fame"/"Jackpot"), set once at fill so both
	// mobile and desktop read the SAME value live off this node instead of
	// each device deriving it from its own owner-token lookup (the source of
	// the HOF-shows-as-PRO desync). It's a struct field — not a sibling write —
	// so the per-pick Update() below re-serializes it every pick and it never
	// gets wiped. omitempty keeps it out of any theoretical fresh-struct write.
	Type string `json:"type,omitempty"`
	// OnDeckDrafter is the OwnerId of the user who picks right AFTER the current
	// on-clock pick. Written every advance so the onPickAdvance Cloud Function
	// (which only sees this RTDB node, not the draftOrder) can send fast-draft
	// Discord/Telegram/push alerts to the ON-DECK player a pick early. Empty at
	// the final pick. omitempty keeps it out of fresh-struct writes.
	OnDeckDrafter string `json:"onDeckDrafter,omitempty"`
}

func GetRealTimeDraftInfoForDraft(draftId string) (*RealTimeDraftInfo, error) {
	realTimeDraftInfoRef := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s/realTimeDraftInfo", draftId))
	var info RealTimeDraftInfo
	err := realTimeDraftInfoRef.Get(context.TODO(), &info)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

func (info *RealTimeDraftInfo) Update(draftId string) error {
	// Use Update, not Set — Set would replace the entire `drafts/{draftId}`
	// node, wiping sibling fields (e.g. `displayName` set by
	// CreateLeagueDraftStateUponFilling for live league-# updates).
	// Update only writes the listed keys.
	realTimeDraftInfoRef := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", draftId))
	err := realTimeDraftInfoRef.Update(context.TODO(), map[string]interface{}{"numPlayers": 10, "realTimeDraftInfo": info})
	if err != nil {
		fmt.Printf("[league#] rtdb.update.error draftId=%s err=%v\n", draftId, err)
		return err
	}
	fmt.Printf("[league#] rtdb.update.ok draftId=%s pickNumber=%d (Update preserves displayName)\n", draftId, info.CurrentPickNumber)
	return nil
}

func CheckIfPlayerIsPickedAlready(draftId, playerId string) error {
	currentPlayers := make(map[string]PlayerStateInfo)
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "playerState", &currentPlayers)
	if err != nil || len(currentPlayers) == 0 {
		fmt.Println("Error because all the players state is nil in default user picking")
		return err
	}
	if currentPlayers[playerId].OwnerAddress != "" || currentPlayers[playerId].OwnerAddress == "null" {
		errMes := fmt.Sprintf("This player was already picked %s so we are not updating or counting this pick\r", playerId)
		fmt.Println(errMes)
		return fmt.Errorf(errMes)
	}
	fmt.Println("verified the player picked was not already owned and closing this timer instance")
	return nil
}

// logCriticalDraftError emits a structured ERROR line for draft-breaking
// failures. Cloud Logging parses the severity, and the admin error-sync cron
// (severity>=ERROR) surfaces it in the admin Logs feed within ~5 minutes.
// The plain-text prints alone were INVISIBLE to alerting — the 2026-06-10
// freeze of 2024-fast-draft-1381 (60s Firestore DeadlineExceeded on the
// playerState write mid-pick → advance + next auto-pick task lost) never
// reached admin. Use for failures that can stall a draft, not benign races.
func logCriticalDraftError(event, draftId string, pick int, err error) {
	fmt.Printf(`{"severity":"ERROR","event":"%s","draftId":"%s","pick":%d,"error":%q}`+"\n", event, draftId, pick, err.Error())
}

func ProcessNewPick(draftId string, pickInfo *PlayerStateInfo, isUserPick bool) error {
	realTimeDraftInfo, err := GetRealTimeDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (GetRealTimeDraftInfoForDraft): draftId=%s err=%v\n", draftId, err)
		return err
	}
	isLastPick := false
	if realTimeDraftInfo.CurrentPickNumber == 150 {
		isLastPick = true
	}

	if time.Now().Unix() > realTimeDraftInfo.PickEndTime && isUserPick {
		err := fmt.Errorf("the pick end time has passed so we are not processing this pick")
		fmt.Printf("ProcessNewPick error: draftId=%s isUserPick=%v pickEndTime=%d err=%v\n", draftId, isUserPick, realTimeDraftInfo.PickEndTime, err)
		return err
	}

	// check if the pick is valid
	if realTimeDraftInfo.CurrentDrafter != pickInfo.OwnerAddress {
		err := fmt.Errorf("the current drafter is not the owner of the pick")
		fmt.Printf("ProcessNewPick error: draftId=%s currentDrafter=%s pickOwner=%s pickInfo=%+v err=%v\n", draftId, realTimeDraftInfo.CurrentDrafter, pickInfo.OwnerAddress, pickInfo, err)
		return err
	} else if realTimeDraftInfo.CurrentPickNumber != pickInfo.PickNum {
		err := fmt.Errorf("the current pick number is not the pick number of the pick")
		fmt.Printf("ProcessNewPick error: draftId=%s currentPickNumber=%d pickPickNum=%d pickInfo=%+v err=%v\n", draftId, realTimeDraftInfo.CurrentPickNumber, pickInfo.PickNum, pickInfo, err)
		return err
	} else if realTimeDraftInfo.CurrentRound != pickInfo.Round {
		err := fmt.Errorf("the current round is not the round of the pick")
		fmt.Printf("ProcessNewPick error: draftId=%s currentRound=%d pickRound=%d pickInfo=%+v err=%v\n", draftId, realTimeDraftInfo.CurrentRound, pickInfo.Round, pickInfo, err)
		return err
	}

	// Persist the pick to its three INDEPENDENT state docs (summary, rosters,
	// playerState) CONCURRENTLY instead of one-after-another, and read draftInfo
	// + league (needed for the advance) alongside them. Each write touches a
	// separate document and none reads another's write, so this is safe — it
	// just shrinks the time before we write realTimeDraftInfo (the signal the
	// draft page + the other device read) from ~3 sequential round-trips to ~1,
	// so they keep up near-instantly instead of lagging 1-2s.
	//
	// SAFETY UNCHANGED: we still wait for ALL saves to succeed BEFORE advancing
	// realTimeDraftInfo below. Any save error returns here (no advance), and the
	// Cloud-Tasks retry re-runs every step — each is replay-idempotent (summary
	// replay guard, roster rosterHasPlayer guard, playerState overwrite). So the
	// freeze/lost-pick protection (save-then-advance) is preserved exactly.
	var (
		summaryErr, rosterErr, playerErr, draftInfoErr, leagueReadErr error
		draftInfo                                                     *DraftInfo
		league                                                        League
	)
	var pickWg sync.WaitGroup
	pickWg.Add(5)
	go func() { defer pickWg.Done(); summaryErr = pickInfo.UpdateDraftSummary(draftId) }()
	go func() {
		defer pickWg.Done()
		rosterErr = UpdateRosterFromPick(draftId, pickInfo.OwnerAddress, pickInfo.Team, pickInfo.Position, pickInfo.PlayerId, pickInfo.DisplayName, pickInfo.Round)
	}()
	go func() { defer pickWg.Done(); playerErr = pickInfo.UpdatePlayerInDraft(draftId) }()
	go func() { defer pickWg.Done(); draftInfo, draftInfoErr = ReturnDraftInfoForDraft(draftId) }()
	go func() { defer pickWg.Done(); leagueReadErr = utils.Db.ReadDocument("drafts", draftId, &league) }()
	pickWg.Wait()

	if summaryErr != nil {
		fmt.Printf("ProcessNewPick error (UpdateDraftSummary): draftId=%s pickInfo=%+v err=%v\n", draftId, pickInfo, summaryErr)
		logCriticalDraftError("pick_summary_write_failed", draftId, pickInfo.PickNum, summaryErr)
		return summaryErr
	}
	if rosterErr != nil {
		fmt.Printf("ProcessNewPick error (UpdateRosterFromPick): draftId=%s pickInfo=%+v err=%v\n", draftId, pickInfo, rosterErr)
		logCriticalDraftError("pick_roster_write_failed", draftId, pickInfo.PickNum, rosterErr)
		return rosterErr
	}
	if playerErr != nil {
		fmt.Printf("ProcessNewPick error (UpdatePlayerInDraft): draftId=%s pickInfo=%+v err=%v\n", draftId, pickInfo, playerErr)
		logCriticalDraftError("pick_player_state_write_failed", draftId, pickInfo.PickNum, playerErr)
		return playerErr
	}
	if draftInfoErr != nil {
		fmt.Printf("ProcessNewPick error (ReturnDraftInfoForDraft): draftId=%s err=%v\n", draftId, draftInfoErr)
		return draftInfoErr
	}
	if leagueReadErr != nil {
		fmt.Printf("ProcessNewPick warning (ReadDocument league): draftId=%s err=%v — using non-slow pick end semantics\n", draftId, leagueReadErr)
	}

	realTimeDraftInfo.LastPick = *pickInfo
	if isLastPick {
		realTimeDraftInfo.IsDraftComplete = true
	} else {
		realTimeDraftInfo.CurrentPickNumber++
		draftInfo.CurrentPickNumber++
		nowUnix := time.Now().Unix()
		realTimeDraftInfo.PickStartTime = nowUnix
		if leagueReadErr == nil && strings.EqualFold(league.DraftType, "slow") {
			realTimeDraftInfo.PickEndTime = SlowDraftPickEndUnix(nowUnix, realTimeDraftInfo.PickLength)
		} else {
			realTimeDraftInfo.PickEndTime = nowUnix + realTimeDraftInfo.PickLength
		}
		realTimeDraftInfo.PickInRound++
		draftInfo.PickInRound++
		if realTimeDraftInfo.PickInRound > 10 {
			realTimeDraftInfo.CurrentRound++
			draftInfo.CurrentRound++
			draftInfo.PickInRound = 1
			realTimeDraftInfo.PickInRound = 1
		}
		var index int
		if draftInfo.CurrentRound%2 == 0 {
			index = len(draftInfo.DraftOrder) - draftInfo.PickInRound
		} else {
			index = draftInfo.PickInRound - 1
		}
		realTimeDraftInfo.CurrentDrafter = draftInfo.DraftOrder[index].OwnerId
		draftInfo.CurrentDrafter = realTimeDraftInfo.CurrentDrafter
		// Stamp the ON-DECK player (whoever picks after the new on-clock pick) so
		// onPickAdvance can fire fast-draft alerts a pick early. "" at the last pick.
		realTimeDraftInfo.OnDeckDrafter = onDeckOwnerForNextPick(draftInfo)
	}

	err = realTimeDraftInfo.Update(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (realTimeDraftInfo.Update): draftId=%s err=%v\n", draftId, err)
		logCriticalDraftError("pick_advance_write_failed", draftId, pickInfo.PickNum, err)
		return err
	}
	err = draftInfo.Update(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (draftInfo.Update): draftId=%s err=%v\n", draftId, err)
		logCriticalDraftError("pick_advance_write_failed", draftId, pickInfo.PickNum, err)
		return err
	}

	// Schedule cloud task to trigger auto draft 5 seconds before pick end time
	// This runs asynchronously so it doesn't block the pick processing
	if !realTimeDraftInfo.IsDraftComplete {
		go scheduleAutoDraftTask(
			draftId,
			realTimeDraftInfo.CurrentDrafter,
			realTimeDraftInfo.CurrentPickNumber,
			realTimeDraftInfo.CurrentRound,
			realTimeDraftInfo.PickEndTime,
		)
		nextDrafter := realTimeDraftInfo.CurrentDrafter
		leagueDisplayName := draftInfo.DisplayName
		// Pick reminder runs only after a pick is recorded, so the first on-clock user is notified by
		// draft-start SMS at room fill, not here (avoids duplicate "your turn" right after the blast).
		if leagueReadErr == nil && strings.EqualFold(league.DraftType, "slow") {
			// Slow drafts (8h/pick): alert the user now on the clock.
			go NotifyPickReminderSMS(draftId, leagueDisplayName, nextDrafter)
		} else {
			// Fast drafts (30s/pick): the on-the-clock user has no time to react to an
			// alert sent at their turn, so instead alert the ON-DECK user (whoever picks
			// right after nextDrafter) a full pick early — "your pick is next". Picks 1-2
			// are already covered by the draft-start blast; there is no on-deck user past
			// the final pick.
			if onDeck := onDeckOwnerForNextPick(draftInfo); onDeck != "" && !strings.HasPrefix(strings.ToLower(onDeck), "bot-") {
				go NotifyOnDeckSMS(draftId, leagueDisplayName, onDeck)
			}
		}
	} else {
		go CloseDraftForAllUsers(draftId)
	}

	return nil
}

// onDeckOwnerForNextPick returns the OwnerId of the user who is ON DECK — i.e.
// who picks immediately after the pick currently on the clock — or "" if the
// current pick is the last one (15 rounds x 10 = 150). It mirrors the snake
// index math used above to advance CurrentDrafter, applied to the next pick.
// draftInfo.CurrentRound / PickInRound / CurrentPickNumber reflect the pick now
// on the clock at this point in ProcessNewPick.
func onDeckOwnerForNextPick(draftInfo *DraftInfo) string {
	if draftInfo == nil || draftInfo.CurrentPickNumber >= 150 {
		return ""
	}
	nextRound := draftInfo.CurrentRound
	nextPickInRound := draftInfo.PickInRound + 1
	if nextPickInRound > 10 {
		nextRound++
		nextPickInRound = 1
	}
	var index int
	if nextRound%2 == 0 {
		index = len(draftInfo.DraftOrder) - nextPickInRound
	} else {
		index = nextPickInRound - 1
	}
	if index < 0 || index >= len(draftInfo.DraftOrder) {
		return ""
	}
	return draftInfo.DraftOrder[index].OwnerId
}

// scheduleAutoDraftTask schedules a Cloud Task to trigger auto-draft 5 seconds before the pick end time
// This function runs in a goroutine and handles errors gracefully without blocking the main flow
func scheduleAutoDraftTask(draftId, ownerId string, pickNum, roundNum int, pickEndTime int64) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Recovered from panic in scheduleAutoDraftTask: %v\n", r)
		}
	}()

	// Read the sortByObj for this user to check AutoDraft setting
	sortByObj := FetchSortForDrafter(draftId, ownerId)

	var scheduleTime int64
	now := time.Now().Unix()

	// If user has AutoPick turned on, schedule for 2 seconds from now
	if sortByObj.AutoDraft {
		scheduleTime = now + 2
		fmt.Printf("User has AutoDraft enabled, scheduling auto-draft task for 2 seconds from now for pick %d\n", pickNum)
	} else if sortByObj.NumPicksMissedConsecutive == 2 {
		scheduleTime = now + 8
		fmt.Printf("User has missed 2 picks in a row, scheduling auto-draft task for 5 seconds from now for pick %d\n", pickNum)
	} else {
		// Calculate schedule time: 5 seconds before pick end time
		scheduleTime = pickEndTime - 2
		if scheduleTime < now {
			// If time has already passed, schedule for 1 second from now
			scheduleTime = now + 1
			fmt.Printf("Pick end time has passed, scheduling auto-draft task immediately for pick %d\n", pickNum)
		}
	}

	// Build the auto-draft URL based on environment
	autoDraftUrl, err := buildAutoDraftURL(draftId, ownerId)
	if err != nil {
		fmt.Printf("Error building auto-draft URL for draft %s, owner %s: %v\n", draftId, ownerId, err)
		return
	}

	// Create the payload
	payload := map[string]interface{}{
		"currentPickNumber": pickNum,
		"currentRound":      roundNum,
		"isServerPick":      true,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("Error marshaling auto-draft payload for pick %d: %v\n", pickNum, err)
		return
	}

	// Create the cloud task
	err = utils.CreateCloudTask(autoDraftUrl, string(payloadBytes), scheduleTime)
	if err != nil {
		fmt.Printf("Error scheduling auto-draft cloud task for draft %s, pick %d: %v\n", draftId, pickNum, err)
		return
	}

	fmt.Printf("Successfully scheduled auto-draft cloud task for draft %s, pick %d (round %d) at timestamp %d\n",
		draftId, pickNum, roundNum, scheduleTime)
}

// getCloudRunServiceURL attempts to get the Cloud Run service URL
// Since Cloud Run URLs contain an unpredictable hash, we need the URL to be set
// via environment variable after the first deployment
func getCloudRunServiceURL() (string, error) {
	// Check if we're running on Cloud Run
	serviceName := utils.GetenvOrDefault("K_SERVICE", "")
	region := utils.GetenvOrDefault("K_REGION", "")
	projectID := utils.GetenvOrDefault("GCP_PROJECT_ID", "")

	if serviceName == "" {
		return "", fmt.Errorf("not running on Cloud Run (K_SERVICE not set)")
	}

	// Cloud Run URLs have the format: https://{service}-{hash}-{region}.a.run.app
	// The hash is random and not predictable, so we cannot construct it automatically
	// The user must set the URL after first deployment

	return "", fmt.Errorf(
		"Cloud Run service URL cannot be determined automatically. "+
			"After your first deployment, get the URL with: "+
			"`gcloud run services describe %s --region=%s --format='value(status.url)'` "+
			"Then set it as an environment variable: "+
			"`gcloud run services update %s --region=%s --set-env-vars=PROD_API_URL=<your-url>` "+
			"Or set SERVICE_URL environment variable. "+
			"Service: %s, Region: %s, Project: %s",
		serviceName, region, serviceName, region, serviceName, region, projectID)
}

// buildAutoDraftURL constructs the full URL for the auto-draft endpoint based on environment
// The URL points to this API's own endpoint, not an external server
// It first tries environment variables, then falls back to Cloud Run metadata if available
func buildAutoDraftURL(draftId, ownerId string) (string, error) {
	// Use ENVIRONMENT environment variable (standardized across codebase)
	env := utils.GetenvOrDefault("ENVIRONMENT", "dev")
	// Normalize environment name
	if env == "production" {
		env = "prod"
	}

	prodUrl := utils.GetenvOrDefault("PROD_API_URL", "")
	stagingUrl := utils.GetenvOrDefault("STAGING_API_URL", "")
	devUrl := utils.GetenvOrDefault("DEV_API_URL", "")

	// Also check for a generic SERVICE_URL that might be set
	serviceURL := utils.GetenvOrDefault("SERVICE_URL", "")

	var baseURL string
	switch {
	case env == "production" || env == "prod":
		if prodUrl != "" {
			baseURL = prodUrl
		} else if serviceURL != "" {
			baseURL = serviceURL
		}
	case env == "staging":
		if stagingUrl != "" {
			baseURL = stagingUrl
		} else if serviceURL != "" {
			baseURL = serviceURL
		}
	default:
		if devUrl != "" {
			baseURL = devUrl
		} else if serviceURL != "" {
			baseURL = serviceURL
		}
	}

	// If no URL is set via environment variable, try to get it from Cloud Run metadata
	if baseURL == "" {
		cloudRunURL, err := getCloudRunServiceURL()
		if err != nil {
			return "", fmt.Errorf("no API URL configured for environment: %s. Options: 1) Set PROD_API_URL/STAGING_API_URL/DEV_API_URL env var, 2) Set SERVICE_URL env var, 3) Configure after first deployment. Error: %v", env, err)
		}
		baseURL = cloudRunURL
	}

	// Remove trailing slash if present
	baseURL = strings.TrimSuffix(baseURL, "/")

	// Construct the full endpoint URL pointing to this API's endpoint
	fullURL := fmt.Sprintf("%s/draft-actions/%s/owner/%s/actions/autoDraft", baseURL, draftId, ownerId)
	return fullURL, nil
}

func GetQueuedPickForUser(pick *PlayerStateInfo, draftInfo *DraftInfo) error {
	globalCurrentPlayers := make(map[string]PlayerStateInfo)
	var queuedPlayers DraftQueue

	// start by checking the queue
	queuedPlayers, err := FetchQueueForDrafter(draftInfo.DraftId, draftInfo.CurrentDrafter)
	if err != nil {
		fmt.Println("No queue found for this draft")
		return err
	}

	// get available players
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftInfo.DraftId), "playerState", &globalCurrentPlayers)
	if err != nil || len(globalCurrentPlayers) == 0 {
		fmt.Println("Error because all the players state is nil in default user picking")
		return err
	}

	// if they have a queue draft off of it
	if len(queuedPlayers) > 0 {
		for i := 0; i < len(queuedPlayers); i++ {
			obj := queuedPlayers[i]
			// Make sure that the player is globally available
			playerState, ok := globalCurrentPlayers[obj.PlayerId]
			if !ok {
				continue
				// TODO remove player from queue
			} else {
				// player is owned so skip
				if playerState.OwnerAddress != "" || playerState.OwnerAddress == "null" {
					continue
				}

				fmt.Println("drafting off of the queue")
				pick.DisplayName = playerState.DisplayName
				pick.PlayerId = playerState.PlayerId
				pick.Team = playerState.Team
				pick.Position = playerState.Position
				pick.OwnerAddress = draftInfo.CurrentDrafter
				pick.PickNum = draftInfo.CurrentPickNumber
				pick.Round = draftInfo.CurrentRound
				// kick back the queued player if we found an eligible one
				return nil
			}
		}
	}

	return errors.New("no players in queue")
}

func GetDraftADP(draftId string) (*UserRankings, error) {
	var league League
	var adpSlice []PlayerDraftInfo

	err := utils.Db.ReadDocument("drafts", draftId, &league)
	if err != nil {
		return nil, err
	}

	adpSlice = league.ADP

	playerRanksLength := len(adpSlice)

	// iterate over map and sort by adp
	userRanks := UserRankings{
		Ranking: make([]PlayerRanking, playerRanksLength),
	}

	for i := 0; i < len(adpSlice); i++ {
		player := PlayerRanking{
			PlayerId: adpSlice[i].PlayerId,
			Rank:     int64(i + 1),
		}

		userRanks.Ranking[i] = player
	}

	if err != nil {
		return nil, err
	}

	return &userRanks, nil
}

func CalculateDefaultPickForUser(pick *PlayerStateInfo, adpPick *PlayerStateInfo, draftInfo *DraftInfo) {
	// bake in short pause to make sure db is updated before we kick off autopick logic
	time.Sleep(1 * time.Second)

	globalCurrentPlayers := make(map[string]PlayerStateInfo)

	// get available players
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftInfo.DraftId), "playerState", &globalCurrentPlayers)
	if err != nil || len(globalCurrentPlayers) == 0 {
		fmt.Println("Error because all the players state is nil in default user picking")
		return
	}
	fmt.Println("Current Player state: ", globalCurrentPlayers)

	// r := &UserRankings{
	// 	Ranking: make([]PlayerRanking, 0),
	// }
	fmt.Println("Current drafter: ", draftInfo.CurrentDrafter)

	haveUserRanks := true
	r, rankErr := GetUserRankingsFromDrafts(draftInfo.CurrentDrafter)

	// if we have an error, don't select from user ranks
	if rankErr != nil {
		fmt.Println("Current drafter has no custom rankings")
		haveUserRanks = false
	} else {
		fmt.Println("Read in User Rankings in default pick selection 1st player: ", len(r.Ranking))
	}

	adpUserRanks, adpErr := GetDraftADP(draftInfo.DraftId)

	if adpErr != nil {
		fmt.Println("ERROR: Unable to find ADP rankings for draft. Cannot autopick.")
		return
	}
	if len(adpUserRanks.Ranking) == 0 && !haveUserRanks {
		fmt.Println("ERROR: ADP rankings are empty for draft and user rankings are empty. Cannot autopick.")
		return
	}

	if len(adpUserRanks.Ranking) > 0 {
		fmt.Println("Read in ADP rankings in default pick selection: ", adpUserRanks.Ranking[0])
	}

	data := &RosterState{
		Rosters: make(map[string]*DraftStateRoster),
	}
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftInfo.DraftId), "rosters", data)
	if err != nil {
		fmt.Println("Error reading in roster map from db: ", err)
		return
	}
	if data.Rosters == nil {
		fmt.Println("Rosters are nil in default pick")
	}

	fmt.Println("rosters: ", data.Rosters)

	var needsQB bool
	var needsRB bool
	var needsTE bool
	var needsWR bool
	var needsDST bool

	if draftInfo.CurrentRound < 12 {
		needsDST = true
		needsQB = true
		needsRB = true
		needsTE = true
		needsWR = true
	} else {
		needsQB = true
		if len(data.Rosters[draftInfo.CurrentDrafter].QB) > 0 {
			needsQB = false
		}
		needsRB = true
		if len(data.Rosters[draftInfo.CurrentDrafter].RB) > 0 {
			needsRB = false
		}
		needsWR = true
		if len(data.Rosters[draftInfo.CurrentDrafter].WR) > 0 {
			needsWR = false
		}
		needsTE = true
		if len(data.Rosters[draftInfo.CurrentDrafter].TE) > 0 {
			needsTE = false
		}
		needsDST = true
		if len(data.Rosters[draftInfo.CurrentDrafter].DST) > 0 {
			needsDST = false
		}
		if !needsQB && !needsRB && !needsWR && !needsTE && !needsDST {
			fmt.Println("min number for each position is reached so we are opening it back up")
			needsQB = true
			needsRB = true
			needsWR = true
			needsTE = true
			needsDST = true
		}
	}

	// if we have user ranks find the player that they would select
	if haveUserRanks {
		for i := 0; i < len(r.Ranking); i++ {
			obj := r.Ranking[i]
			playerState, ok := globalCurrentPlayers[obj.PlayerId]
			if !ok {
				fmt.Printf("Could not find user rank %s in players map\r", obj.PlayerId)
				fmt.Printf("PlayerId: %s, Object: %v, player State: %v\r", obj.PlayerId, obj, playerState)
				return
			}
			if playerState.OwnerAddress == "" && playerState.PickNum == 0 {
				if strings.ToLower(playerState.Position) == "qb" && !needsQB {
					continue
				} else if strings.ToLower(playerState.Position) == "rb" && !needsRB {
					continue
				} else if strings.ToLower(playerState.Position) == "wr" && !needsWR {
					continue
				} else if strings.ToLower(playerState.Position) == "te" && !needsTE {
					continue
				} else if strings.ToLower(playerState.Position) == "dst" && !needsDST {
					continue
				}
				pick.DisplayName = playerState.DisplayName
				pick.PlayerId = playerState.PlayerId
				pick.Team = playerState.Team
				pick.Position = playerState.Position
				pick.OwnerAddress = draftInfo.CurrentDrafter
				pick.PickNum = draftInfo.CurrentPickNumber
				pick.Round = draftInfo.CurrentRound
				break
			}
		}
	}

	// always fetch best player by adp
	for i := 0; i < len(adpUserRanks.Ranking); i++ {
		adpObj := adpUserRanks.Ranking[i]
		adpPlayerState, ok := globalCurrentPlayers[adpObj.PlayerId]
		if !ok {
			fmt.Printf("Could not find ADP %s in players map\r", adpObj.PlayerId)
			fmt.Printf("PlayerId: %s, Object: %v, player State: %v\r", adpObj.PlayerId, adpObj, adpPlayerState)
			return
		}
		if adpPlayerState.OwnerAddress == "" && adpPlayerState.PickNum == 0 {
			if strings.ToLower(adpPlayerState.Position) == "qb" && !needsQB {
				continue
			} else if strings.ToLower(adpPlayerState.Position) == "rb" && !needsRB {
				continue
			} else if strings.ToLower(adpPlayerState.Position) == "wr" && !needsWR {
				continue
			} else if strings.ToLower(adpPlayerState.Position) == "te" && !needsTE {
				continue
			} else if strings.ToLower(adpPlayerState.Position) == "dst" && !needsDST {
				continue
			}
			adpPick.DisplayName = adpPlayerState.DisplayName
			adpPick.PlayerId = adpPlayerState.PlayerId
			adpPick.Team = adpPlayerState.Team
			adpPick.Position = adpPlayerState.Position
			adpPick.OwnerAddress = draftInfo.CurrentDrafter
			adpPick.PickNum = draftInfo.CurrentPickNumber
			adpPick.Round = draftInfo.CurrentRound
			break
		}
	}
	fmt.Println("default user rank pick: ", pick)
	fmt.Println("default adp pick: ", adpPick)
	fmt.Println("returning from default draft pick function")
}

type SortByObj struct {
	SortBy                    string `json:"sortBy"`
	AutoDraft                 bool   `json:"autoDraft"`
	NumPicksMissedConsecutive int    `json:"numPicksMissedConsecutive"`
	LastMissedPickNum         int    `json:"lastMissedPickNum"` // per-pick idempotency key for the miss counter (auto-draft double-count fix)
}

// GetSortByADPPreference checks if the user has "sort by adp" enabled for the draft
// This checks in the draft state for user preferences. If not found, defaults to false.
func FetchSortForDrafter(draftId string, user string) SortByObj {
	var sortBy SortByObj

	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state/sortOrders/%s", draftId, user), "sort", &sortBy)
	if err != nil {
		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state/sortOrders/%s", draftId, user), "sort", &SortByObj{
			SortBy:                    "ADP",
			AutoDraft:                 false,
			NumPicksMissedConsecutive: 0,
		})
		if err != nil {
			fmt.Println("Error creating or updating sort order for user: ", err)
		}
		return SortByObj{
			SortBy:                    "ADP",
			AutoDraft:                 false,
			NumPicksMissedConsecutive: 0,
		}
	}

	return sortBy
}

func UpdateSortForDrafter(draftId string, user string, sortBy SortByObj) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state/sortOrders/%s", draftId, user), "sort", &sortBy)
	if err != nil {
		return fmt.Errorf("error updating sort order for user: %v", err)
	}
	return nil
}

func CalculateAutoPickForUser(draftId string, currentDrafter string, currentPickNumber int, currentRound int, realTimeDraftInfo *RealTimeDraftInfo) (*PlayerStateInfo, error) {

	draftinfo, err := ReturnDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("CalculateAutoPickForUser error (ReturnDraftInfoForDraft): draftId=%s err=%v\n", draftId, err)
		return nil, err
	}

	if realTimeDraftInfo.CurrentPickNumber > currentPickNumber {
		err := errors.New("the current pick number is greater than the current pick number, so this pick was already completed")
		fmt.Printf("CalculateAutoPickForUser error: draftId=%s currentDrafter=%s currentPickNumber=%d currentRound=%d realTimePickNumber=%d err=%v\n", draftId, currentDrafter, currentPickNumber, currentRound, realTimeDraftInfo.CurrentPickNumber, err)
		return nil, err
	}

	if realTimeDraftInfo.CurrentDrafter != currentDrafter {
		err := errors.New("the current drafter is not the drafter of the default pick")
		fmt.Printf("CalculateAutoPickForUser error: draftId=%s currentDrafter=%s realTimeDrafter=%s err=%v\n", draftId, currentDrafter, realTimeDraftInfo.CurrentDrafter, err)
		return nil, err
	}

	if realTimeDraftInfo.CurrentPickNumber != currentPickNumber {
		err := errors.New("the current pick number is not the pick number of the default pick")
		fmt.Printf("CalculateAutoPickForUser error: draftId=%s currentPickNumber=%d realTimePickNumber=%d err=%v\n", draftId, currentPickNumber, realTimeDraftInfo.CurrentPickNumber, err)
		return nil, err
	}

	if realTimeDraftInfo.CurrentRound != currentRound {
		err := errors.New("the current round is not the round of the default pick")
		fmt.Printf("CalculateAutoPickForUser error: draftId=%s currentRound=%d realTimeRound=%d err=%v\n", draftId, currentRound, realTimeDraftInfo.CurrentRound, err)
		return nil, err
	}

	// Initialize pick object
	var defaultPick PlayerStateInfo

	// Priority 1: Check if user has a queued pick available
	err = GetQueuedPickForUser(&defaultPick, draftinfo)
	if err == nil && defaultPick.PlayerId != "" {
		// Found a queued pick, process it
		fmt.Println("Processing default pick from queue")
		return &defaultPick, nil
	}

	var adpPick PlayerStateInfo
	var userRankPick PlayerStateInfo
	CalculateDefaultPickForUser(&userRankPick, &adpPick, draftinfo)

	// Check if "sort by adp" is enabled
	sortByADP := FetchSortForDrafter(draftId, currentDrafter)

	// Select the appropriate pick based on preference
	if sortByADP.SortBy == "ADP" {
		// Use ADP pick if sort by ADP is enabled
		if adpPick.PlayerId != "" {
			fmt.Println("Using ADP-based default pick")
			return &adpPick, nil
		}
		// Fallback to user rank pick if ADP pick is empty
		if userRankPick.PlayerId != "" {
			fmt.Println("ADP pick not available, falling back to user rank pick")
			return &userRankPick, nil
		}
	} else {
		// Use user rank pick if sort by ADP is not enabled
		if userRankPick.PlayerId != "" {
			fmt.Println("Using user rank-based default pick")
			return &userRankPick, nil
		}
		// Fallback to ADP pick if user rank pick is empty
		if adpPick.PlayerId != "" {
			fmt.Println("User rank pick not available, falling back to ADP pick")
			return &adpPick, nil
		}
	}

	err = errors.New("unable to calculate a default pick - no queue, user rankings, or ADP pick available")
	fmt.Printf("CalculateAutoPickForUser error: draftId=%s currentDrafter=%s currentPickNumber=%d currentRound=%d err=%v\n", draftId, currentDrafter, currentPickNumber, currentRound, err)
	return nil, err
}

func FindTokenIdFromOwnerId(ownerId string, users []LeagueUser) string {
	for i := 0; i < len(users); i++ {
		if strings.ToLower(ownerId) == strings.ToLower(users[i].OwnerId) {
			return users[i].TokenId
		}
	}

	return ""
}

func CloseDraftForAllUsers(draftId string) error {
	realTimeDraftInfo, err := GetRealTimeDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"close.read_rtdb_failed","error":"%v"}`+"\n", draftId, err)
		return err
	}

	if !realTimeDraftInfo.IsDraftComplete {
		err = errors.New("the draft is not complete so we cannot close it")
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"close.not_complete","isDraftComplete":%v}`+"\n", draftId, realTimeDraftInfo.IsDraftComplete)
		return err
	}

	var rosterState RosterState
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &rosterState)
	if err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"close.read_rosters_failed","error":"%v"}`+"\n", draftId, err)
		return err
	}

	var league League
	if err := utils.Db.ReadDocument("drafts", draftId, &league); err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"close.read_league_failed","error":"%v"}`+"\n", draftId, err)
		return err
	}

	var wg sync.WaitGroup
	var renderFailures int32
	var persistFailures int32

	for user, roster := range rosterState.Rosters {
		totalPicks := len(roster.DST) + len(roster.QB) + len(roster.RB) + len(roster.TE) + len(roster.WR)
		if totalPicks != 15 {
			// Don't abort the whole close just because one user's roster is malformed —
			// log it loudly so admin sees it, and keep going so the other 9 users still
			// get their cards minted.
			fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","event":"close.invalid_roster","rosterCount":%d}`+"\n", draftId, user, totalPicks)
			atomic.AddInt32(&persistFailures, 1)
			continue
		}

		tokenRoster := TokenRoster{DST: roster.DST, QB: roster.QB, RB: roster.RB, TE: roster.TE, WR: roster.WR}

		tokenId := FindTokenIdFromOwnerId(user, league.CurrentUsers)
		if tokenId == "" {
			fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","event":"close.no_token_id"}`+"\n", draftId, user)
			atomic.AddInt32(&persistFailures, 1)
			continue
		}

		token, err := GetCardFromLeagueAndOwner(draftId, user)
		if err != nil {
			fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","event":"close.get_card_failed","error":"%v"}`+"\n", draftId, user, err)
			atomic.AddInt32(&persistFailures, 1)
			continue
		}
		token.Roster = &tokenRoster
		token.WeekScore = "0"
		token.SeasonScore = "0"

		// STEP 1 — Persist the roster to Firestore synchronously, BEFORE the
		// image render call. If anything goes wrong in step 2 (image-gen
		// timeout, network blip, bad response), the card still has its real
		// roster data. The 2026-05-13 incident lost a user's entire team
		// because the in-memory mutation happened before the goroutine and
		// the goroutine's silent `return` left the Firestore copy stale.
		if err := persistDraftCardFields(token, league.LeagueId); err != nil {
			fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","cardId":"%s","event":"close.persist_roster_failed","error":"%v"}`+"\n", draftId, user, token.CardId, err)
			atomic.AddInt32(&persistFailures, 1)
			continue
		}

		wg.Add(1)
		go func(token *DraftToken, owner string) {
			defer wg.Done()
			// STEP 2 — Render the image. If this fails after retries, the
			// card from step 1 is still good (roster + scores intact, just
			// the default placeholder image). Admin can re-trigger render
			// without losing roster data.
			if err := renderAndPersistCardImage(token, league.LeagueId); err != nil {
				fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","cardId":"%s","event":"close.image_render_failed","error":"%v"}`+"\n", draftId, owner, token.CardId, err)
				atomic.AddInt32(&renderFailures, 1)
				return
			}
			fmt.Printf(`{"severity":"INFO","draftId":"%s","owner":"%s","cardId":"%s","event":"close.card_done"}`+"\n", draftId, owner, token.CardId)
		}(token, user)
	}

	wg.Wait()

	totalFailures := atomic.LoadInt32(&persistFailures) + atomic.LoadInt32(&renderFailures)
	if totalFailures > 0 {
		// Loud structured ERROR — picked up by the cloud-error-sync cron and
		// surfaced in the admin Server Errors badge.
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"close.partial_failure","persistFailures":%d,"renderFailures":%d}`+"\n", draftId, atomic.LoadInt32(&persistFailures), atomic.LoadInt32(&renderFailures))
	} else {
		fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"close.complete","cards":%d}`+"\n", draftId, len(rosterState.Rosters))
	}

	realTimeDraftInfo.IsDraftClosed = true
	if err := realTimeDraftInfo.Update(draftId); err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"close.update_rtdb_failed","error":"%v"}`+"\n", draftId, err)
		return err
	}

	return nil
}

// persistDraftCardFields writes a DraftToken to all 4 collections that hold
// per-card data: draftTokenMetadata, drafts/{leagueId}/cards, draftTokens,
// and owners/{ownerId}/usedDraftTokens. Each write is wrapped so a partial
// failure produces an error with the specific collection that failed.
//
// Callers should treat this as best-effort-atomic: if it returns an error,
// at least one collection didn't get updated, and the card may be
// inconsistent across the 4 stores. The caller should log and (ideally)
// retry from an admin path.
func persistDraftCardFields(token *DraftToken, leagueId string) error {
	if token == nil {
		return errors.New("nil token")
	}
	metadata := token.ConvertToMetadata()
	if err := utils.Db.CreateOrUpdateDocument("draftTokenMetadata", token.CardId, metadata); err != nil {
		return fmt.Errorf("draftTokenMetadata write: %w", err)
	}
	if err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", leagueId), token.CardId, *token); err != nil {
		return fmt.Errorf("drafts/%s/cards write: %w", leagueId, err)
	}
	if err := utils.Db.CreateOrUpdateDocument("draftTokens", token.CardId, *token); err != nil {
		return fmt.Errorf("draftTokens write: %w", err)
	}
	if err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId, *token); err != nil {
		return fmt.Errorf("owners/%s/usedDraftTokens write: %w", token.OwnerId, err)
	}
	return nil
}

// imageGeneratorURL returns the image generator endpoint, falling back to
// the prod Cloud Function when no override is set. This indirection lets us
// flip staging to its own image generator without a code deploy — set
// IMAGE_GENERATOR_URL on the Cloud Run service.
func imageGeneratorURL() string {
	return utils.GetenvOrDefault(
		"IMAGE_GENERATOR_URL",
		"https://us-central1-sbs-prod-env.cloudfunctions.net/draft-image-generator",
	)
}

// renderCardImage POSTs the token to the image-generator Cloud Function and
// returns the updated DraftToken (with the rendered ImageUrl set). Bounded
// timeout, descriptive errors so the caller can log specifics.
func renderCardImage(token *DraftToken) (*DraftToken, error) {
	body, err := json.Marshal(ImageGeneratorRequest{Card: *token})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequest("POST", imageGeneratorURL(), bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Add("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http call: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("image generator returned HTTP %d", res.StatusCode)
	}
	var updated DraftToken
	if err := json.NewDecoder(res.Body).Decode(&updated); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if updated.CardId == "" {
		// Defensive: the response should at minimum echo the cardId. If it
		// doesn't, persisting would corrupt the card record.
		return nil, errors.New("image generator response missing cardId")
	}
	return &updated, nil
}

// renderAndPersistCardImage calls the image generator with retries and
// persists the updated card to all 4 collections on success. Backoff
// schedule covers Cloud Function cold starts (~10s) and brief transient
// outages (~30s) — anything longer than that and admin uses the manual
// Recover Card button. STEP 1 already saved the roster, so a render
// failure here is a degraded image, never lost team data.
//
// Retry budget: 5 attempts over ~44 seconds total (0s, 1s, 3s, 10s, 30s).
// The loop exits the moment any attempt succeeds — pays nothing when
// image-gen is healthy.
func renderAndPersistCardImage(token *DraftToken, leagueId string) error {
	var lastErr error
	backoffs := []time.Duration{
		0,
		1 * time.Second,
		3 * time.Second,
		10 * time.Second,
		30 * time.Second,
	}
	for attempt := 1; attempt <= len(backoffs); attempt++ {
		if backoffs[attempt-1] > 0 {
			time.Sleep(backoffs[attempt-1])
		}
		updated, err := renderCardImage(token)
		if err == nil {
			if err := persistDraftCardFields(updated, leagueId); err != nil {
				// Render worked but write failed — log the specific step and
				// retry the whole thing (cheap idempotent re-render).
				lastErr = fmt.Errorf("persist updated card: %w", err)
				fmt.Printf(`{"severity":"WARNING","cardId":"%s","attempt":%d,"event":"close.persist_after_render_failed","error":"%v"}`+"\n", token.CardId, attempt, err)
				continue
			}
			return nil
		}
		lastErr = err
		fmt.Printf(`{"severity":"WARNING","cardId":"%s","attempt":%d,"event":"close.image_render_retry","error":"%v"}`+"\n", token.CardId, attempt, err)
	}
	return fmt.Errorf("image render failed after %d attempts: %w", len(backoffs), lastErr)
}

// RecoverCardForOwner re-runs the close-draft per-card flow for a single
// (draftId, ownerId) — useful when one user's card got lost in a partial
// close failure. Reads the user's roster from state, re-builds the token,
// persists the roster, then renders + persists the image. Safe to call
// repeatedly: each step is idempotent.
func RecoverCardForOwner(draftId, ownerId string) error {
	var rosterState RosterState
	if err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &rosterState); err != nil {
		return fmt.Errorf("read rosters: %w", err)
	}
	roster, ok := rosterState.Rosters[ownerId]
	if !ok || roster == nil {
		return fmt.Errorf("no roster for owner %s in draft %s", ownerId, draftId)
	}
	totalPicks := len(roster.DST) + len(roster.QB) + len(roster.RB) + len(roster.TE) + len(roster.WR)
	if totalPicks != 15 {
		return fmt.Errorf("invalid roster: %d picks (expected 15)", totalPicks)
	}

	var league League
	if err := utils.Db.ReadDocument("drafts", draftId, &league); err != nil {
		return fmt.Errorf("read league: %w", err)
	}
	tokenId := FindTokenIdFromOwnerId(ownerId, league.CurrentUsers)
	if tokenId == "" {
		return fmt.Errorf("no tokenId for owner %s in league %s", ownerId, draftId)
	}

	token, err := GetCardFromLeagueAndOwner(draftId, ownerId)
	if err != nil {
		return fmt.Errorf("get card: %w", err)
	}
	token.Roster = &TokenRoster{DST: roster.DST, QB: roster.QB, RB: roster.RB, TE: roster.TE, WR: roster.WR}
	token.WeekScore = "0"
	token.SeasonScore = "0"

	if err := persistDraftCardFields(token, league.LeagueId); err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","cardId":"%s","event":"recover.persist_failed","error":"%v"}`+"\n", draftId, ownerId, token.CardId, err)
		return fmt.Errorf("persist roster: %w", err)
	}

	if err := renderAndPersistCardImage(token, league.LeagueId); err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","owner":"%s","cardId":"%s","event":"recover.render_failed","error":"%v"}`+"\n", draftId, ownerId, token.CardId, err)
		return fmt.Errorf("render image: %w", err)
	}

	fmt.Printf(`{"severity":"INFO","draftId":"%s","owner":"%s","cardId":"%s","event":"recover.card_done"}`+"\n", draftId, ownerId, token.CardId)
	return nil
}
