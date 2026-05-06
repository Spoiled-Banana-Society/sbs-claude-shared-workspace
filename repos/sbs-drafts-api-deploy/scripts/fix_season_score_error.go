package main

import (
	"context"
	"fmt"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func UpdateCardsSubcollection(scoreObj *models.CardScores) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", scoreObj.Card.LeagueId), scoreObj.CardId, scoreObj.Card)
	if err != nil {
		return err
	}
	return nil
}

func UpdateScoresSubcollection(scoreObj *models.CardScores) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/2024REG-15/cards", scoreObj.Card.LeagueId), scoreObj.CardId, scoreObj)
	if err != nil {
		return err
	}
	return nil
}

func UpdateDraftLeaderboard(scoreObj *models.CardScores) error {
	err := utils.Db.CreateOrUpdateDocument("draftTokenLeaderboard/2024REG-15/cards", scoreObj.CardId, scoreObj)
	if err != nil {
		return err
	}
	return nil
}

// func DeleteLeagueDocument(leagueId string) error {
// 	err := utils.Db.DeleteDocument("drafts", leagueId)
// 	return err
// }

func GetCardsFromLeaderboard() []*models.CardScores {
	data, err := utils.Db.Client.Collection("draftTokenLeaderboard/2024REG-15/cards").Documents(context.Background()).GetAll()
	if err != nil {
		panic(err)
	}

	cardsArr := make([]*models.CardScores, 0)
	for i := 0; i < len(data); i++ {
		var scoreObj models.CardScores
		err := data[i].DataTo(&scoreObj)
		if err != nil {
			panic(err)
		}

		cardsArr = append(cardsArr, &scoreObj)
	}

	fmt.Println("Number of cards returned from leaderboard: ", len(cardsArr))
	return cardsArr
}

func main() {
	utils.NewDatabaseClient(true)
	// for i := 1; i <= 100; i++ {
	// 	leagueId := fmt.Sprintf("2024-live-draft-playoffs-%d", i)
	// 	err := DeleteCardsSubcollection(leagueId)
	// 	if err != nil {
	// 		panic(err)
	// 	}

	// 	err = DeleteScoresSubcollection(leagueId)
	// 	if err != nil {
	// 		panic(err)
	// 	}

	// 	err = DeleteLeagueDocument(leagueId)
	// 	if err != nil {
	// 		panic(err)
	// 	}
	// }

	leaderboard := GetCardsFromLeaderboard()
	for i := 0; i < len(leaderboard); i++ {
		obj := leaderboard[i]

		obj.PrevWeekSeasonScore = 0
		obj.Card.SeasonScore = obj.Card.WeekScore
		obj.ScoreSeason = obj.ScoreWeek

		if len(obj.Roster.DST) != 0 {
			for j := 0; j < len(obj.Roster.DST); j++ {
				obj.Roster.DST[j].PrevWeekSeasonContribution = 0
				obj.Roster.DST[j].ScoreSeason = obj.Roster.DST[j].ScoreWeek
			}
		}

		if len(obj.Roster.QB) != 0 {
			for j := 0; j < len(obj.Roster.QB); j++ {
				obj.Roster.QB[j].PrevWeekSeasonContribution = 0
				obj.Roster.QB[j].ScoreSeason = obj.Roster.QB[j].ScoreWeek
			}
		}

		if len(obj.Roster.RB) != 0 {
			for j := 0; j < len(obj.Roster.RB); j++ {
				obj.Roster.RB[j].PrevWeekSeasonContribution = 0
				obj.Roster.RB[j].ScoreSeason = obj.Roster.RB[j].ScoreWeek
			}
		}

		if len(obj.Roster.TE) != 0 {
			for j := 0; j < len(obj.Roster.TE); j++ {
				obj.Roster.TE[j].PrevWeekSeasonContribution = 0
				obj.Roster.TE[j].ScoreSeason = obj.Roster.TE[j].ScoreWeek
			}
		}

		if len(obj.Roster.WR) != 0 {
			for j := 0; j < len(obj.Roster.WR); j++ {
				obj.Roster.WR[j].PrevWeekSeasonContribution = 0
				obj.Roster.WR[j].ScoreSeason = obj.Roster.WR[j].ScoreWeek
			}
		}

		if err := UpdateDraftLeaderboard(obj); err != nil {
			panic(err)
		}
		if err := UpdateScoresSubcollection(obj); err != nil {
			panic(err)
		}
		if err := UpdateCardsSubcollection(obj); err != nil {
			panic(err)
		}
		if err := utils.Db.CreateOrUpdateDocument("draftTokens", obj.CardId, obj.Card); err != nil {
			panic(err)
		}
		if err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", obj.OwnerId), obj.CardId, obj.Card); err != nil {
			panic(err)
		}

		fmt.Println("Updated Card in all places: ", obj.Card)
	}
}
