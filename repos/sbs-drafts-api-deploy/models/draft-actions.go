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
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type RealTimeDraftInfo struct {
	CurrentDrafter    string          `json:"currentDrafter"`
	CurrentPickNumber int             `json:"pickNumber"`
	CurrentRound      int             `json:"roundNum"`
	PickInRound       int             `json:"pickInRound"`
	PickEndTime       int64           `json:"pickEndTime"`
	PickLength        int64           `json:"pickLength"`
	DraftStartTime    int64           `json:"draftStartTime"` // Unix timestamp when draft starts
	LastPick          PlayerStateInfo `json:"lastPick"`
	IsDraftComplete   bool            `json:"isDraftComplete"`
	IsDraftClosed     bool            `json:"isDraftClosed"`
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
	realTimeDraftInfoRef := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", draftId))
	err := realTimeDraftInfoRef.Set(context.TODO(), map[string]interface{}{"numPlayers": 10, "realTimeDraftInfo": info})
	if err != nil {
		fmt.Println("ERROR in updating real time draft info: ", err)
		return err
	}
	fmt.Printf("Real time draft info: %v\n for draft %s has updated the real time draft info\n", info, draftId)
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

	// Update Draft State in database
	err = pickInfo.UpdateDraftSummary(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (UpdateDraftSummary): draftId=%s pickInfo=%+v err=%v\n", draftId, pickInfo, err)
		return err
	}

	err = UpdateRosterFromPick(draftId, pickInfo.OwnerAddress, pickInfo.Team, pickInfo.Position, pickInfo.PlayerId, pickInfo.DisplayName, pickInfo.Round)
	if err != nil {
		fmt.Printf("ProcessNewPick error (UpdateRosterFromPick): draftId=%s pickInfo=%+v err=%v\n", draftId, pickInfo, err)
		return err
	}

	err = pickInfo.UpdatePlayerInDraft(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (UpdatePlayerInDraft): draftId=%s pickInfo=%+v err=%v\n", draftId, pickInfo, err)
		return err
	}

	draftInfo, err := ReturnDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (ReturnDraftInfoForDraft): draftId=%s err=%v\n", draftId, err)
		return err
	}

	realTimeDraftInfo.LastPick = *pickInfo
	if isLastPick {
		realTimeDraftInfo.IsDraftComplete = true
	} else {
		realTimeDraftInfo.CurrentPickNumber++
		draftInfo.CurrentPickNumber++
		realTimeDraftInfo.PickEndTime = time.Now().Unix() + realTimeDraftInfo.PickLength
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
	}

	err = realTimeDraftInfo.Update(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (realTimeDraftInfo.Update): draftId=%s err=%v\n", draftId, err)
		return err
	}
	err = draftInfo.Update(draftId)
	if err != nil {
		fmt.Printf("ProcessNewPick error (draftInfo.Update): draftId=%s err=%v\n", draftId, err)
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
	} else {
		go CloseDraftForAllUsers(draftId)
	}

	return nil
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
		fmt.Printf("CloseDraftForAllUsers error (GetRealTimeDraftInfoForDraft): draftId=%s err=%v\n", draftId, err)
		return err
	}

	if !realTimeDraftInfo.IsDraftComplete {
		err = errors.New("the draft is not complete so we cannot close it")
		fmt.Printf("CloseDraftForAllUsers error: draftId=%s isDraftComplete=%v err=%v\n", draftId, realTimeDraftInfo.IsDraftComplete, err)
		return err
	}

	var rosterState RosterState
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &rosterState)
	if err != nil {
		fmt.Printf("CloseDraftForAllUsers error (ReadDocument rosters): draftId=%s err=%v\n", draftId, err)
		return err
	}

	var wg sync.WaitGroup
	for user, roster := range rosterState.Rosters {
		if (len(roster.DST) + len(roster.QB) + len(roster.RB) + len(roster.TE) + len(roster.WR)) != 15 {
			err = fmt.Errorf("this users roster does not have a valid lineup: %s and we are returning", user)
			fmt.Printf("CloseDraftForAllUsers error: draftId=%s user=%s rosterCount=%d err=%v\n", draftId, user, len(roster.DST)+len(roster.QB)+len(roster.RB)+len(roster.TE)+len(roster.WR), err)
			return err
		}

		TokenRoster := TokenRoster{
			DST: roster.DST,
			QB:  roster.QB,
			RB:  roster.RB,
			TE:  roster.TE,
			WR:  roster.WR,
		}

		var league League
		err = utils.Db.ReadDocument("drafts", draftId, &league)
		if err != nil {
			fmt.Printf("CloseDraftForAllUsers error (ReadDocument league): draftId=%s user=%s err=%v\n", draftId, user, err)
			return err
		}

		tokenId := FindTokenIdFromOwnerId(user, league.CurrentUsers)
		if tokenId == "" {
			err = errors.New("could not find the token id for the user")
			fmt.Printf("CloseDraftForAllUsers error: draftId=%s user=%s err=%v\n", draftId, user, err)
			return err
		}

		token, err := GetCardFromLeagueAndOwner(draftId, user)
		if err != nil {
			fmt.Printf("CloseDraftForAllUsers error (GetCardFromLeagueAndOwner): draftId=%s user=%s err=%v\n", draftId, user, err)
			return err
		}
		token.Roster = &TokenRoster
		token.WeekScore = "0"
		token.SeasonScore = "0"

		wg.Add(1)
		go func(wg *sync.WaitGroup, token *DraftToken) {
			defer wg.Done()
			reqBody := ImageGeneratorRequest{
				Card: *token,
			}
			body, err := json.Marshal(reqBody)
			if err != nil {
				return
			}
			r, err := http.NewRequest("POST", "https://us-central1-sbs-prod-env.cloudfunctions.net/draft-image-generator", bytes.NewBuffer(body))
			if err != nil {
				return
			}
			r.Header.Add("Content-Type", "application/json")
			client := &http.Client{}
			res, err := client.Do(r)
			if err != nil {
				return
			}
			defer res.Body.Close()
			var UpdatedDraftToken DraftToken
			err = json.NewDecoder(res.Body).Decode(&UpdatedDraftToken)
			if err != nil {
				return
			}
			metadata := UpdatedDraftToken.ConvertToMetadata()
			err = utils.Db.CreateOrUpdateDocument("draftTokenMetadata", UpdatedDraftToken.CardId, metadata)
			if err != nil {
				return
			}
			err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", league.LeagueId), UpdatedDraftToken.CardId, UpdatedDraftToken)
			if err != nil {
				return
			}
			err = utils.Db.CreateOrUpdateDocument("draftTokens", UpdatedDraftToken.CardId, UpdatedDraftToken)
			if err != nil {
				return
			}
			err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", UpdatedDraftToken.OwnerId), UpdatedDraftToken.CardId, UpdatedDraftToken)
			if err != nil {
				return
			}
			fmt.Println("Converted card to metadata and updated with this object: ", *metadata)
		}(&wg, token)
	}

	wg.Wait()
	realTimeDraftInfo.IsDraftClosed = true
	err = realTimeDraftInfo.Update(draftId)
	if err != nil {
		fmt.Printf("CloseDraftForAllUsers error (realTimeDraftInfo.Update): draftId=%s err=%v\n", draftId, err)
		return err
	}

	return nil
}
