package models

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"

	"cloud.google.com/go/firestore"
)

type PlayerInfo struct {
	// unique player Id will probably just be the team and position such as BUFQB
	PlayerId string `json:"playerId"`
	// display name for front end
	DisplayName string `json:"displayName"`
	// team of the player
	Team string `json:"team"`
	// position of player
	Position string `json:"position"`
	// address of the user who drafted this player
	OwnerAddress string `json:"ownerAddress"`
	// number pick that this player was selected.... will default to nil in the database
	PickNum int `json:"pickNum"`
	// the round which this player was drafted in
	Round int `json:"round"`
}

type SortByObj struct {
	SortBy 						string							`json:"sortBy"`
}

func (pick *PlayerInfo) UpdatePlayerInDraft(draftId string) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}
	ctx := context.Background()

	_, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Doc("playerState").Update(ctx, []firestore.Update{
		{
			Path:  pick.PlayerId,
			Value: pick,
		},
	})
	if err != nil {
		return err
	}
	return nil
}

func RevertPlayerUpdateInDraft(draftId string, pick PlayerInfo) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}

	pick.OwnerAddress = ""
	pick.PickNum = 0
	pick.Round = 0

	ctx := context.Background()
	_, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Doc("playerState").Update(ctx, []firestore.Update{
		{
			Path:  pick.PlayerId,
			Value: pick,
		},
	})
	if err != nil {
		return err
	}
	return nil
}

type PfpData struct {
	ImageUrl    string `json:"imageUrl"`
	NftContract string `json:"nftContract"`
	DisplayName string `json:"displayName"`
}

type DraftSummaryObject struct {
	PlayerInfo PlayerInfo `json:"playerInfo"`
	PfpInfo    PfpData    `json:"pfpInfo"`
}

type DraftSummary struct {
	Summary []DraftSummaryObject `json:"summary"`
}

func (pick *PlayerInfo) UpdateDraftSummary(draftId string) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}
	summary := DraftSummary{
		Summary: make([]DraftSummaryObject, 0),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
	if err != nil {
		return err
	}

	if pick.PickNum > 150 {
		fmt.Println("ERROR updating draft summary because pick number is greater than 150")
		return fmt.Errorf("error updating draft summary because pick number is greater than 150")
	}

	if summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId == "" {
		summary.Summary[pick.PickNum-1].PlayerInfo = *pick

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
		if err != nil {
			return err
		}
		fmt.Printf("Updated Draft Summary For Pick %d: %v\r", pick.PickNum - 1, summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId)
		return nil
	}

	fmt.Printf("New Pick: %v, is submitting a pick that already shows being drafted in the summary with %v\r", *pick, summary.Summary[pick.PickNum-1])
	return fmt.Errorf("new Pick: %v, is submitting a pick that already shows being drafted in the summary with %v\r", *pick, summary.Summary[pick.PickNum-1])
}

func RevertAdditionToDraftSummary(draftId string, pick PlayerInfo) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}
	summary := DraftSummary{
		Summary: make([]DraftSummaryObject, 0),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
	if err != nil {
		return err
	}

	if summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId != pick.PlayerId {
		fmt.Println("It appears that this pick is not actually in the summary")
		return fmt.Errorf("it appears that this pick is not actually in the summary so we are returning and not messing with the sumary")
	}

	summary.Summary[pick.PickNum-1].PlayerInfo.DisplayName = ""
	summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId = ""
	summary.Summary[pick.PickNum-1].PlayerInfo.Team = ""
	summary.Summary[pick.PickNum-1].PlayerInfo.Position = ""

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
	if err != nil {
		return err
	}
	return nil

}

func CheckIfPlayerIsPickedAlready(draftId, playerId string) error {
	currentPlayers := make(map[string]PlayerInfo)
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

func (p *PlayerInfo) MakePickFromPlayerInfo(draftId, clientAddress, channelName, managerId string) error {
	err := CheckIfPlayerIsPickedAlready(draftId, p.PlayerId)
	if err != nil {
		fmt.Printf(`{"severity":"WARNING","draftId":"%s","event":"pick_player_already_taken","player":"%s"}`+"\n", draftId, p.PlayerId)
		return err
	}

	err = p.UpdateDraftSummary(draftId)
	if err != nil {
		fmt.Println("error updating draft summary: ", err)
		//c.AlertUserOfInvalidDraftPick(err.Error())
		RevertPlayerUpdateInDraft(draftId, *p)
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"pick_summary_update_failed","pick":%d}`+"\n", draftId, p.PickNum)
		return err
	}
	fmt.Println("updated draft summary from a pick recieved on the client")

	err = UpdateRosterFromPick(draftId, clientAddress, p.Team, p.Position, p.PlayerId, p.DisplayName, p.Round)
	if err != nil {
		fmt.Println("Error updating the roster from the pick event that was received")
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"pick_roster_update_failed"}`+"\n", draftId)
		return err
	}
	fmt.Println("updated rosters from a pick recieved on the client")

	// update database with new pick
	err = p.UpdatePlayerInDraft(draftId)
	if err != nil {
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"pick_state_update_failed"}`+"\n", draftId)
		return err
	}
	fmt.Println("updated player state from a pick recieved on the client")

	data, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("error marhsalling playerInfo Object in MakePickFromPlayerInfo: %v", err)
	}

	var m utils.RedisMessage
	m.Sender = managerId
	m.EventType = utils.PickSubChannel
	m.Payload = []byte(data)

	data, err = json.Marshal(&m)
	if err != nil {
		return err
	}

	// publish NewPickMessage to redis channel
	res := utils.PubConn.Publish(context.Background(), channelName, data)
	if res.Err() != nil {
		return res.Err()
	}
	fmt.Println("Just published new pick to redis channel")
	fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"pick_published_to_redis","pick":%d,"player":"%s"}`+"\n", draftId, p.PickNum, p.PlayerId)

	return nil
}

func FetchSortForDrafter(draftId string, user string) (string) {
	var sortBy SortByObj

	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state/sortOrders/%s", draftId, user), "sort", &sortBy)
	if err != nil {
		return "ADP"
	}

	return sortBy.SortBy
}
