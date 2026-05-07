package models

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"
)

type LeagueUser struct {
	OwnerId string `json:"ownerId"`
	TokenId string `json:"tokenId"`
}

type DraftInfo struct {
	DraftId           string       `json:"draftId"`
	DisplayName       string       `json:"displayName"`
	DraftStartTime    int64        `json:"draftStartTime"`
	PickLength        int64        `json:"pickLength"`
	CurrentDrafter    string       `json:"currentDrafter"`
	CurrentPickNumber int          `json:"pickNumber"`
	CurrentRound      int          `json:"roundNum"`
	PickInRound       int          `json:"pickInRound"`
	DraftOrder        []LeagueUser `json:"draftOrder"`
	ADP								[]PlayerDraftInfo `json:"adp"`
	sync.Mutex
}

func ReturnDraftInfoForDraft(draftId string, draftOrder []string) *DraftInfo {
	var info DraftInfo
	collectionString := fmt.Sprintf("drafts/%s/state", draftId)
	err := utils.Db.ReadDocument(collectionString, "info", &info)
	if err != nil {
		fmt.Println("Error reading draft info for draft: ", err)
		return nil
	}

	return &info
}

func (info *DraftInfo) UpdateDraftInfoFromNewPick(channelName string, managerId string) error {

	// info.CurrentPickNumber++
	// info.PickInRound++

	// will need to check in the future if the draft is over and send out a draft complete event
	if info.PickInRound == 10 {
		if info.CurrentRound == 15 && info.CurrentPickNumber == 150 {
			fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"draft_completing","pick":150}`+"\n", info.DraftId)
			// Write final state to Firestore BEFORE completing — otherwise info doc stays stale
			collectionPath := fmt.Sprintf("drafts/%s/state", info.DraftId)
			if err := utils.Db.CreateOrUpdateDocument(collectionPath, "info", &info); err != nil {
				fmt.Println("Error writing final draft info to Firestore on pick 150: ", err)
				// Continue anyway — don't block completion for a Firestore write failure
			}

			mes := SendDraftComplete{
				HasCompletedClosing: false,
			}

			data, err := json.Marshal(&mes)
			if err != nil {
				return err
			}

			var m utils.RedisMessage
			m.Sender = managerId
			m.EventType = utils.CompleteSubChannel
			m.Payload = data

			d, err := json.Marshal(&m)
			if err != nil {
				return err
			}

			res := utils.PubConn.Publish(context.Background(), channelName, d)
			if res.Err() != nil {
				return res.Err()
			}

			fmt.Println("published message to redis complete channel to show that the draft is complete but still needs to go through the closing process: ", time.Now().Unix())

			err = info.InitiateDraftClosingProcess(info.DraftId)
			if err != nil {
				fmt.Println("Error in the cosing process: ", err)
				fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"draft_close_error"}`+"\n", info.DraftId)
				return err
			}
			return nil
		} else {
			info.CurrentRound++
			info.CurrentPickNumber++
			info.PickInRound = 1
			fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"draft_advanced","pick":%d,"round":%d}`+"\n", info.DraftId, info.CurrentPickNumber, info.CurrentRound)
		}
	} else {
		info.PickInRound++
		info.CurrentPickNumber++
		fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"draft_advanced","pick":%d,"round":%d}`+"\n", info.DraftId, info.CurrentPickNumber, info.CurrentRound)
	}

	// determine the current drafter by pick information
	var index int
	if info.CurrentRound%2 == 0 {
		index = len(info.DraftOrder) - info.PickInRound
	} else {
		index = info.PickInRound - 1
	}
	fmt.Printf("Switching from %s who just picked to %s\r", info.CurrentDrafter, info.DraftOrder[index].OwnerId)
	info.CurrentDrafter = info.DraftOrder[index].OwnerId

	//go utils.AlertUserItIsTheirTurn(info.DraftId, info.DisplayName, info.CurrentDrafter, info.DraftOrder[index].TokenId)

	collectionPath := fmt.Sprintf("drafts/%s/state", info.DraftId)
	err := utils.Db.CreateOrUpdateDocument(collectionPath, "info", &info)
	if err != nil {
		return err
	}
	if info == nil {
		fmt.Println("info is nil here before so it is erroring out when info is nil")
	}
	fmt.Printf("Draft Info: %v\r", info)

	var updateMessage utils.RedisMessage
	updateMessage.Sender = managerId
	m, err := json.Marshal(&info)
	if err != nil {
		return err
	}
	updateMessage.Payload = m
	updateMessage.EventType = utils.InfoSubChannel
	mes, err := json.Marshal(updateMessage)
	if err != nil {
		return err
	}

	res := utils.PubConn.Publish(context.Background(), channelName, mes)
	if res.Err() != nil {
		fmt.Println("Error in publishing the updated draft info: ", res.Err())
		return res.Err()
	}
	//fmt.Println("published message to redis complete channel to show that the draft is completeand all cards have been generated: ", time.Now().Unix())

	return nil
}

func (info *DraftInfo) updateDraftInfoOnRedisMessage(currentDrafter string, pickNum, pickInRound, currentRound int) {
	info.Lock()
	defer info.Unlock()
	info.CurrentDrafter = currentDrafter
	info.CurrentPickNumber = pickNum
	info.PickInRound = pickInRound
	info.CurrentRound = currentRound
	return
}

type SendDraftComplete struct {
	HasCompletedClosing bool `json:"hasCompletedClosing"`
}

func (info *DraftInfo) InitiateDraftClosingProcess(managerId string) error {
	fmt.Println("initiating closing process in InitiateDraftClosingProcess")
	ros := RosterState{
		Rosters: make(map[string]*DraftStateRoster),
	}
	collectionString := fmt.Sprintf("drafts/%s/state", info.DraftId)
	err := utils.Db.ReadDocument(collectionString, "rosters", &ros)
	if err != nil {
		return err
	}
	fmt.Println("Got roster map for closing sequence")

	league := League{
		CurrentUsers: make([]LeagueUser, 0),
	}
	err = utils.Db.ReadDocument("drafts", info.DraftId, &league)
	if err != nil {
		return err
	}
	fmt.Println("got league document for draft in closing sequence")

	var wg sync.WaitGroup

	for i := 0; i < len(info.DraftOrder); i++ {
		user := info.DraftOrder[i]
		tokenId := FindTokenIdFromOwnerId(user.OwnerId, league.CurrentUsers)
		var token DraftToken
		err := utils.Db.ReadDocument("draftTokens", tokenId, &token)
		if err != nil {
			return err
		}
		r := ros.Rosters[user.OwnerId]
		if (len(r.DST) + len(r.QB) + len(r.RB) + len(r.TE) + len(r.WR)) != 15 {
			return fmt.Errorf("this users roster does not have a valid lineup: %s and we are returning", user.OwnerId)
		}
		ros := &TokenRoster{
			DST: r.DST,
			QB:  r.QB,
			RB:  r.RB,
			TE:  r.TE,
			WR:  r.WR,
		}
		token.Roster = ros
		fmt.Println("Token: ", token)
		wg.Add(1)
		fmt.Printf("Starting Closing process for card %s in %s\r", token.CardId, token.LeagueId)
		go AddCardToLeague(&token, &league, &wg)
	}
	fmt.Println("waiting for all 10 cards to update before continuing")
	wg.Wait()
	fmt.Println("All 10 go routines are complete")
	UpdateLeagueOnDraftClose(league)

	mes := SendDraftComplete{
		HasCompletedClosing: true,
	}

	data, err := json.Marshal(&mes)
	if err != nil {
		return err
	}

	var m utils.RedisMessage
	m.Sender = managerId
	m.EventType = utils.CompleteSubChannel
	m.Payload = data

	d, err := json.Marshal(&m)
	if err != nil {
		fmt.Println("Error marshaling redis message in InitiateDraftClosingProcess: ", err)
		return err
	}

	res := utils.PubConn.Publish(context.Background(), fmt.Sprintf("%s-channel", info.DraftId), d)
	if res.Err() != nil {
		return res.Err()
	}

	fmt.Println("Finished closing draft sequence and published message to redis")
	return nil
}

func FindTokenIdFromOwnerId(ownerId string, users []LeagueUser) string {
	for i := 0; i < len(users); i++ {
		if strings.ToLower(ownerId) == strings.ToLower(users[i].OwnerId) {
			return users[i].TokenId
		}
	}

	return ""
}
