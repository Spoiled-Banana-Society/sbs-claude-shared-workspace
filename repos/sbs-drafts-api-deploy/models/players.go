package models

import (
	"context"
	"fmt"
	"strings"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type PlayerStateInfo struct {
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

type StateMap struct {
	Players map[string]PlayerStateInfo
}

type PlayerRanking struct {
	PlayerId string  `json:"playerId"`
	Rank     int64   `json:"rank"`
	Score    float64 `json:"score"`
}

type UserRankings struct {
	Ranking []PlayerRanking `json:"ranking"`
}

type StatsObject struct {
	PlayerId        string   `json:"playerId"`
	AverageScore    float64  `json:"averageScore"`
	HighestScore    float64  `json:"highestScore"`
	Top5Finishes    int64    `json:"top5Finishes"`
	ByeWeek         string   `json:"byeWeek"`
	ADP             float64  `json:"adp"`
	PlayersFromTeam []string `json:"playersFromTeam"`
}

type DraftPlayerRanking struct {
	// unique player Id will probably just be the team and position such as BUFQB
	PlayerId string `json:"playerId"`
	// holds the state object for player
	PlayerStateInfo PlayerStateInfo `json:"playerStateInfo"`
	Stats           StatsObject     `json:"stats"`
	Ranking         PlayerRanking   `json:"ranking"`
}

func CreateRankingObject(ranking PlayerRanking, stats StatsObject, info PlayerStateInfo) DraftPlayerRanking {
	return DraftPlayerRanking{
		PlayerId:        info.PlayerId,
		PlayerStateInfo: info,
		Stats:           stats,
		Ranking:         ranking,
	}
}

func GetUserRankingsFromDrafts(ownerId string) (*UserRankings, error) {
	r := UserRankings{
		Ranking: make([]PlayerRanking, 0),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", &r)
	if err != nil {
		if ok := strings.Contains(strings.ToLower(err.Error()), "notfound"); ok {

			err := utils.Db.ReadDocument("playerStats2024", "rankings", &r)
			if err != nil {
				return nil, err
			}

			err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", r)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}

	} else if len(r.Ranking) == 0 {
		fmt.Println("made it into the second if statement")
		err := utils.Db.ReadDocument("playerStats2024", "rankings", &r)
		if err != nil {
			return nil, err
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", r)
		if err != nil {
			return nil, err
		}
	}

	return &r, nil
}

type StatsMap struct {
	Players map[string]StatsObject `json:"players"`
}

func ReturnPlayerStateWithRankings(ownerId string, draftId string) ([]DraftPlayerRanking, error) {
	fmt.Println("Inside of returnPlayerStateWIthRankins")
	userRankings, err := GetUserRankingsFromDrafts(ownerId)
	if err != nil {
		return nil, err
	}
	//fmt.Println("Got user rankings: ", userRankings)

	state := make(map[string]PlayerStateInfo)
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "playerState", &state)
	if err != nil {
		return nil, err
	}
	if len(state) == 0 {
		fmt.Println("state is empty")
	}

	stats := StatsMap{
		Players: make(map[string]StatsObject),
	}
	err = utils.Db.ReadDocument("playerStats2024", "playerMap", &stats)
	if err != nil {
		return nil, err
	}

	res := make([]DraftPlayerRanking, 0)

	for _, rank := range userRankings.Ranking {
		stateInfo := state[rank.PlayerId]
		if stateInfo.PlayerId == "" {
			fmt.Println("This should not be empty")
		}
		obj := CreateRankingObject(rank, stats.Players[rank.PlayerId], stateInfo)
		res = append(res, obj)
	}

	return res, nil
}

func (pick *PlayerStateInfo) UpdateDraftSummary(draftId string) error {
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
		fmt.Printf("Updated Draft Summary For Pick %d: %v\r", pick.PickNum-1, summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId)
		return nil
	}

	fmt.Printf("New Pick: %v, is submitting a pick that already shows being drafted in the summary with %v\r", *pick, summary.Summary[pick.PickNum-1])
	return fmt.Errorf("new Pick: %v, is submitting a pick that already shows being drafted in the summary with %v\r", *pick, summary.Summary[pick.PickNum-1])
}

func RevertAdditionToDraftSummary(draftId string, pick PlayerStateInfo) error {
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

func (pick *PlayerStateInfo) UpdatePlayerInDraft(draftId string) error {
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
