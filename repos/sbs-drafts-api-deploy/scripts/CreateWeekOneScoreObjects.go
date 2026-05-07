package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type FillDraftData struct {
	DraftId string
	Cards   []*models.DraftToken
}

func GetAllFilledDraftLeaguesInfo() ([]*FillDraftData, error) {
	data, err := utils.Db.Client.Collection("drafts").Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error reading draft documents")
	}

	draftsData := make([]*FillDraftData, 0)
	for i := 0; i < len(data); i++ {
		var league models.League
		err = data[i].DataTo(&league)
		if err != nil {
			fmt.Println("ERROR reading data snapshot into draft token", data[i].Ref.ID)
			return nil, err
		}
		if league.LeagueId != "2024-fast-draft-364" {
			continue
		}
		splitArr := strings.Split(league.LeagueId, "-")
		if splitArr[0] != "2024" {
			continue
		}
		if !league.IsLocked {
			continue
		}

		var leagueData FillDraftData
		leagueData.DraftId = league.LeagueId

		isValid := true

		for j := 0; j < len(league.CurrentUsers); j++ {
			if !isValid {
				continue
			}
			user := league.CurrentUsers[j]

			var token models.DraftToken
			err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/cards", league.LeagueId), user.TokenId, &token)
			if err != nil {
				if strings.Contains(err.Error(), "NotFound") {
					fmt.Println("ERROR found league without cards subcollection: ", league.LeagueId)
					isValid = false
					continue
				} else {
					panic(err)
				}
			}
			fmt.Println(token.CardId)
			if token.CardId == "3253" {
				leagueData.Cards = append(leagueData.Cards, &token)
			}
		}

		if !isValid {
			continue
		}
		draftsData = append(draftsData, &leagueData)
	}
	return draftsData, nil
}

func CreateScoreObjectForPlayer(player models.RosterPlayer, position string) models.ScoreObject {
	return models.ScoreObject{
		PlayerId:                   player.PlayerId,
		PrevWeekSeasonContribution: 0,
		ScoreSeason:                0,
		ScoreWeek:                  0,
		IsUsedInCardScore:          false,
		Team:                       player.Team,
		Position:                   position,
	}
}

func CreateScoreRosterForCard(token models.DraftToken) models.ScoreRoster {
	var ScoreRoster models.ScoreRoster
	for i := 0; i < len(token.Roster.QB); i++ {
		ScoreRoster.QB = append(ScoreRoster.QB, CreateScoreObjectForPlayer(token.Roster.QB[i], "QB"))
	}
	for i := 0; i < len(token.Roster.RB); i++ {
		ScoreRoster.RB = append(ScoreRoster.RB, CreateScoreObjectForPlayer(token.Roster.RB[i], "RB"))
	}
	for i := 0; i < len(token.Roster.WR); i++ {
		ScoreRoster.WR = append(ScoreRoster.WR, CreateScoreObjectForPlayer(token.Roster.WR[i], "WR"))
	}
	for i := 0; i < len(token.Roster.TE); i++ {
		ScoreRoster.TE = append(ScoreRoster.TE, CreateScoreObjectForPlayer(token.Roster.TE[i], "TE"))
	}
	for i := 0; i < len(token.Roster.DST); i++ {
		ScoreRoster.DST = append(ScoreRoster.DST, CreateScoreObjectForPlayer(token.Roster.DST[i], "DST"))
	}
	return ScoreRoster
}

func CreateWeekScoreObjectForLeague(leagueData *FillDraftData) error {
	var leagueRosters models.RosterState
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", leagueData.DraftId), "rosters", &leagueRosters)
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") {
			return nil
		}
		fmt.Println("Error reading rosters document: ", err)
		return err
	}

	for i := 0; i < len(leagueData.Cards); i++ {
		token := leagueData.Cards[i]

		var owner models.Owner
		err = utils.Db.ReadDocument("owners", token.OwnerId, &owner)
		if err != nil {
			if strings.Contains(err.Error(), "NotFound") {
				newOwner, err := models.CreateOwnerDocument(token.OwnerId)
				if err != nil {
					return err
				}
				owner = *newOwner
			} else {
				fmt.Println("ERROR reading owner document: ", token.OwnerId)
				return err
			}

		}

		scoreObj := &models.CardScores{
			Card:                *token,
			CardId:              token.CardId,
			Roster:              CreateScoreRosterForCard(*token),
			ScoreWeek:           0,
			ScoreSeason:         0,
			PrevWeekSeasonScore: 0,
			OwnerId:             token.OwnerId,
			Level:               token.Level,
			PFP:                 owner.PFP,
		}
		//fmt.Println(scoreObj)

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/2024REG-01/cards", token.LeagueId), token.CardId, scoreObj)
		if err != nil {
			fmt.Println("Error updating score object in drafts: ", token.CardId)
			return err
		}

		err = utils.Db.CreateOrUpdateDocument("draftTokenLeaderboard/2024REG-01/cards", token.CardId, scoreObj)
		if err != nil {
			fmt.Println("Error updating score object in leaderboard: ", token.CardId)
			return err
		}
	}
	return nil
}

type DraftData struct {
	DraftId        string                `json:"draftId"`
	DraftDoc       models.League         `json:"draftDoc"`
	ConnectionList models.ConnectionList `json:"connectionList"`
	Info           models.DraftInfo      `json:"info"`
	PlayerState    models.Players        `json:"playerState"`
	Rosters        models.RosterState    `json:"rosters"`
	Summary        models.DraftSummary   `json:"summary"`
	Cards          []models.DraftToken   `json:"cards"`
}

type DraftDataJSON struct {
	Drafts []DraftData `json:"drafts"`
}

func main() {
	utils.NewDatabaseClient(true)
	draftLeagueData, err := GetAllFilledDraftLeaguesInfo()
	if err != nil {
		panic(err)
	}

	// wg := sync.WaitGroup{}
	// ticket := make(chan struct{}, 30)
	for i := 0; i < len(draftLeagueData); i++ {
		leagueData := draftLeagueData[i]
		//fmt.Println("starting processing for ", leagueData.DraftId)
		// wg.Add(1)
		// go func(wg *sync.WaitGroup, leagueData *FillDraftData) {
		// 	defer func() {
		// 		<-ticket
		// 		wg.Done()
		// 	}()
		err := CreateWeekScoreObjectForLeague(leagueData)
		if err != nil {
			fmt.Printf("ERROR creating league for %s: %v\r", leagueData.DraftId, err)
			return
		}
		fmt.Println("Finished up creating score obj for ", leagueData.DraftId)
		// 	return
		// }(&wg, leagueData)
	}

	// fmt.Println("waiting for goroutines to finish")
	// wg.Wait()

	fmt.Println("Created week 1 in all draft leagues and added all cards to leaderboard")

}

// func main() {
// 	utils.NewDatabaseClient(true)
// 	data, err := utils.Db.Client.Collection("drafts").Documents(context.Background()).GetAll()
// 	if err != nil {
// 		fmt.Println("Error reading draft documents")
// 	}

// 	for i := 0; i < len(data); i++ {
// 		var league models.League
// 		err := data[i].DataTo(&league)
// 		if err != nil {
// 			panic(err)
// 		}

// 		if !league.IsLocked {
// 			continue
// 		}

// 		data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/scores/2024REG-01/cards", league.LeagueId)).Documents(context.Background()).GetAll()
// 		if err != nil {
// 			fmt.Printf("ERROR in %s when getting score cards: %v\r", league.LeagueId, err)
// 			continue
// 		}

// 		if len(data) != 10 {
// 			fmt.Println("This league does not have 10 score objects in it for week 1: ", league.LeagueId)
// 			continue
// 		}
// 	}

// 	fmt.Println("All done")
// }
