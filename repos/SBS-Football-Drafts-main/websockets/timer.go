package websockets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/models"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"
)

type DraftTimer struct {
	timeRemaining        int64
	DefaultPick          models.PlayerInfo
	currentDrafter       string
	DraftRoom            *Draft
	StartOfTurnTimestamp int64
	EndOfTurnTimestamp   int64
}

type TimerUpdateMessage struct {
	TimeRemaining        int64  `json:"timeRemaining"`
	StartOfTurnTimestamp int64  `json:"startOfTurnTimestamp"`
	EndOfTurnTimestamp   int64  `json:"endOfTurnTimestamp"`
	CurrentDrafter       string `json:"currentDrafter"`
}

type PlayersMap struct {
	Players map[string]*models.PlayerInfo `json:"players"`
}

type PlayerRanking struct {
	PlayerId string  `json:"playerId"`
	Rank     int     `json:"rank"`
	Score    float64 `json:"score"`
}

func StartDraftTimerForCurrentPick(currentDrafter string, pickLength int64, draft *Draft) {
	if draft.DraftInfo.CurrentPickNumber > 150 {
		fmt.Println("Draft already complete, not starting timer")
		fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_skip_complete"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
		return
	}

	fmt.Println("Starting Timer")
	fmt.Println(currentDrafter)
	fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_started","drafter":"%s"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber, currentDrafter)

	// Staging bots pick instantly (2s delay) instead of waiting the full timer
	isBot := strings.HasPrefix(currentDrafter, "bot-")
	if isBot {
		pickLength = 5
		fmt.Printf("Bot drafter %s — using 5s timer instead of full pick length\n", currentDrafter)
	}

	startTime := time.Now().Unix()

	ctx := context.Background()
	timer := &DraftTimer{
		timeRemaining:        pickLength,
		DefaultPick:          models.PlayerInfo{},
		currentDrafter:       currentDrafter,
		DraftRoom:            draft,
		StartOfTurnTimestamp: startTime,
		EndOfTurnTimestamp:   startTime + pickLength,
	}

	draft.CurrentTimer = timer

	adpPick := models.PlayerInfo{}
	rankPick := models.PlayerInfo{}

	// create go routine and pass in a pointer to the DraftTimer instance
	go CalculateDefaultPickForUser(&rankPick, &adpPick, draft.DraftInfo)

	// create subscription to pick redis channel for draft room
	pubsub := utils.SubConn.Subscribe(ctx, draft.RedisChannels.DraftChannelName)
	ch := pubsub.Channel()

	// send ws message to drafters on new clock
	SendTimerUpdateMessage(draft)

	ticker := time.NewTicker(1 * time.Second)

	// stop the timer once the pick is over (?)
	defer func() {
		pubsub.Unsubscribe(context.Background(), draft.RedisChannels.DraftChannelName)
		err := pubsub.Close()
		if err != nil {
			fmt.Println("ERROR in closing pubsub connection in timer go routine: ", err)
		}

		ticker.Stop()
	}()

	for {
		select {
		case <-ticker.C:
			if time.Now().Unix() >= timer.EndOfTurnTimestamp {
				fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_expired","drafter":"%s"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber, timer.currentDrafter)
				// fetch the queue before we sleep
				pick := models.PlayerInfo{}
				GetQueuedPickForUser(&pick, draft.DraftInfo)
				// short delay incase a user pick came in at the same time
				time.Sleep(250 * time.Millisecond)
				// fetch the draft summary to make sure that pick is not already in
				var summary models.DraftSummary
				err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draft.draftId), "summary", &summary)
				if err != nil {
					fmt.Println("Error reading summary in timer")
					fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"timer_summary_read_failed"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
					return
				}

				// set the default pick based on the current sort order
				sortOrder := models.FetchSortForDrafter(draft.draftId, timer.currentDrafter)
				if sortOrder == "ADP" || rankPick.PlayerId == "" {
					fmt.Println("Timer default ADP")
					fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_default_set","source":"ADP"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
					timer.DefaultPick = adpPick
				} else {
					fmt.Println("Timer default RANK")
					fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_default_set","source":"RANK"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
					timer.DefaultPick = rankPick
				}

				// If default pick was never set, use ADP pick as fallback
				if timer.DefaultPick.PickNum == 0 {
					if adpPick.PickNum > 0 {
						fmt.Println("DefaultPick not set, falling back to ADP pick")
						timer.DefaultPick = adpPick
					} else if rankPick.PickNum > 0 {
						fmt.Println("DefaultPick not set, falling back to rank pick")
						timer.DefaultPick = rankPick
					} else {
						fmt.Println("ERROR: No valid pick found at all — skipping auto-pick")
						fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"timer_no_valid_pick"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
						return
					}
				}

				// Summary is indexed starting at 0
				if summary.Summary[timer.DefaultPick.PickNum - 1].PlayerInfo.PlayerId == "" {
					// nothing in the queue
					if pick.PlayerId == "" {
						// use the default if there is no queue
						pick = timer.DefaultPick
						fmt.Println("Using the default pick")
					}

					// Mark complete BEFORE publishing to Redis — prevents race where
					// Redis listener starts a new timer before IsCommplete is set
					if draft.DraftInfo.CurrentPickNumber == 150 {
						draft.IsCommplete = true
						fmt.Println("marked draft is complete from inside of the autopick in timer (set before Redis publish)")
					}

					err := pick.MakePickFromPlayerInfo(draft.draftId, timer.currentDrafter, draft.getDraftChannelName(), draft.draftManager.Id)
					if err != nil {
						fmt.Println("Error in making the pick from the player info so we are going to skip this pick. RIP Drafter")
						fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"timer_pick_failed","error":"%v"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber, err)
						// if the pick has been made skip to the next pick by not returning here
					}

					// Do what we need to do to advance the round if necessary
					if draft.DraftInfo.CurrentPickNumber == 150 {
						// already marked complete above
					} else {
						// 
						if draft.DraftInfo.CurrentPickNumber != timer.DefaultPick.PickNum {
							fmt.Println("We are NOT going to advance the drafter because it has already advanced.")
							fmt.Println(draft.DraftInfo.CurrentPickNumber)
							fmt.Println(timer.DefaultPick.PickNum)
							fmt.Printf(`{"severity":"WARNING","draftId":"%s","pick":%d,"event":"timer_already_advanced"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
							return
						}
					}

					// Go to the next pick
					fmt.Println("Going to next pick")
					fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_pick_complete","player":"%s"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber, pick.PlayerId)
					if err := draft.GoToNextPickInDraftInfo(); err != nil {
						fmt.Println("Error updating draft info to next pick in default pick: ", err)
						fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"timer_advance_failed","error":"%v"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber, err)
						return
					}
				} else {
					fmt.Printf(`{"severity":"WARNING","draftId":"%s","pick":%d,"event":"timer_slot_already_filled"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
				}

				return
			}
		case message := <-ch:
			var mes utils.RedisMessage
			if err := json.Unmarshal([]byte(message.Payload), &mes); err != nil {
				fmt.Println("Error unmarshaling message from redis into utils.RedisMessage: ", err)
				continue
			}
			if mes.EventType == utils.PickSubChannel {
				fmt.Println("Pick event received on redis channel so we are returning and cleaning up timer")
				fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"timer_manual_pick_received"}`+"\n", draft.draftId, draft.DraftInfo.CurrentPickNumber)
				return
			}
		}
	}
}

func SendTimerUpdateMessage(draft *Draft) {
	ctx := context.Background()

	t := &TimerUpdateMessage{
		CurrentDrafter:       draft.CurrentTimer.currentDrafter,
		StartOfTurnTimestamp: draft.CurrentTimer.StartOfTurnTimestamp,
		EndOfTurnTimestamp:   draft.CurrentTimer.EndOfTurnTimestamp,
	}
	data, err := json.Marshal(t)
	if err != nil {
		fmt.Println("ERROR marshalling data for timer message so we are returning: ", err)
	}

	m := &utils.RedisMessage{
		Sender:    draft.draftManager.Id,
		EventType: utils.TimerSubChannel,
		Payload:   data,
	}
	d, err := json.Marshal(m)
	if err != nil {
		fmt.Println("ERROR marshalling redis message to send in timer channel: ", err)
		return
	}
	if err := utils.PubConn.Publish(ctx, draft.RedisChannels.DraftChannelName, d).Err(); err != nil {
		fmt.Println("ERROR publishing message to timer redis channel: ", err)
		return
	}
}

func GetSizeOfRosterForDrafter(drafter string, draftInfo *models.DraftInfo) (size int) {
	data := &models.RosterState{
		Rosters: make(map[string]*models.DraftStateRoster),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftInfo.DraftId), "rosters", data)
	if err != nil {
		fmt.Println("Error reading in roster map from db: ", err)
		return
	}
	if data.Rosters == nil {
		fmt.Println("Rosters are nil in default pick")
	}

	size = 0
	size += len(data.Rosters[draftInfo.CurrentDrafter].QB)
	size += len(data.Rosters[draftInfo.CurrentDrafter].RB)
	size += len(data.Rosters[draftInfo.CurrentDrafter].WR)
	size += len(data.Rosters[draftInfo.CurrentDrafter].TE)
	size += len(data.Rosters[draftInfo.CurrentDrafter].DST)

	return size
}

func GetQueuedPickForUser(pick *models.PlayerInfo, draftInfo *models.DraftInfo) error {
	globalCurrentPlayers := make(map[string]models.PlayerInfo)
	var queuedPlayers models.DraftQueue

	// start by checking the queue
	queuedPlayers, err := models.FetchQueueForDrafter(draftInfo.DraftId, draftInfo.CurrentDrafter)
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

func CalculateDefaultPickForUser(pick *models.PlayerInfo, adpPick *models.PlayerInfo, draftInfo *models.DraftInfo) {
	// bake in short pause to make sure db is updated before we kick off autopick logic
	time.Sleep(1 * time.Second)
	
	globalCurrentPlayers := make(map[string]models.PlayerInfo)

	// get available players
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftInfo.DraftId), "playerState", &globalCurrentPlayers)
	if err != nil || len(globalCurrentPlayers) == 0 {
		fmt.Println("Error because all the players state is nil in default user picking")
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"calc_default_player_state_error"}`+"\n", draftInfo.DraftId, draftInfo.CurrentPickNumber)
		return
	}
	fmt.Println("Current Player state: ", globalCurrentPlayers)

	// r := &UserRankings{
	// 	Ranking: make([]PlayerRanking, 0),
	// }
	fmt.Println("Current drafter: ", draftInfo.CurrentDrafter)

	haveUserRanks := true
	r, rankErr := models.GetUserRankings(draftInfo.CurrentDrafter)

	// if we have an error, don't select from user ranks
	if rankErr != nil {
		fmt.Println("Current drafter has no custom rankings")
		haveUserRanks = false
	} else {
		fmt.Println("Read in User Rankings in default pick selection 1st player: ", r.Ranking[0])
	}

	adpUserRanks, adpErr := models.GetDraftADP(draftInfo.DraftId)

	if adpErr != nil {
		fmt.Println("ERROR: Unable to find ADP rankings for draft. Cannot autopick.")
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"calc_default_adp_error"}`+"\n", draftInfo.DraftId, draftInfo.CurrentPickNumber)
		return
	}
	fmt.Println("Read in ADP rankings in default pick selection: ", adpUserRanks.Ranking[0])

	data := &models.RosterState{
		Rosters: make(map[string]*models.DraftStateRoster),
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
				fmt.Printf("Could not find user rank %s in players map — skipping\r", obj.PlayerId)
				continue
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
			fmt.Printf("Could not find ADP %s in players map — skipping\r", adpObj.PlayerId)
			continue
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

type StartTimeCountdownMessage struct {
	TimeRemaining int64 `json:"timeRemaining"`
}

func WaitForStartOfDraft(startTime int64, pickLength int64, draft *Draft) {
	hasAlertedUserOfDraftStart := false
	for {
		now := time.Now().Unix()
		if now >= startTime {
			fmt.Println("starting draft timer for first pick in draft")
			go StartDraftTimerForCurrentPick(draft.DraftInfo.CurrentDrafter, pickLength, draft)
			break
		}

		if startTime-now > 300 {
			fmt.Println("SLeeping for 375 seconds")
			time.Sleep(275 * time.Second)
		} else if (startTime-now) > 25 && (startTime-now < 30) && !hasAlertedUserOfDraftStart {
			wg := sync.WaitGroup{}

			for i := 0; i < len(draft.DraftInfo.DraftOrder); i++ {
				user := draft.DraftInfo.DraftOrder[i]
				wg.Add(1)
				go func() {
					utils.AlertUserOfDraftStart(draft.draftId, draft.DraftInfo.DisplayName, user.OwnerId, user.TokenId)
					fmt.Printf("Alerted %s in league %s that the draft is starting\r", user.OwnerId, draft.draftId)
					wg.Done()
				}()
			}
			wg.Wait()
			hasAlertedUserOfDraftStart = true
		} else {
			fmt.Println("Sleeping for 1 second")
			time.Sleep(1 * time.Second)
		}
	}

	fmt.Println("started draft and alerted all users on mobile that the draft is starting")
}
