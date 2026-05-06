package main

import (
	"fmt"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func main() {
	utils.NewDatabaseClient(true)
	newGameweek := "2024REG-17"
	leagueId := "2024-hof-playoffs-eliminated-from-reg-playoffs"
	leagueDisplayName := "2024 BBB Hall of Fame Playoffs"
	cardIds := []string{"2251"}

	hofCards := make([]*models.CardScores, 0)
	for i := 0; i < len(cardIds); i++ {
		cardId := cardIds[i]
		var card models.CardScores
		err := utils.Db.ReadDocument("draftTokenLeaderboard/2024REG-16/cards", cardId, &card)
		if err != nil {
			panic(err)
		}
		hofCards = append(hofCards, &card)
	}

	for i := 0; i < len(hofCards); i++ {
		cardObj := hofCards[i]

		cardObj.Card.LeagueId = leagueId
		cardObj.Card.LeagueDisplayName = leagueDisplayName

		cardObj.Card.WeekScore = "0"
		cardObj.PrevWeekSeasonScore = cardObj.ScoreSeason
		cardObj.ScoreWeek = 0

		for j := 0; j < len(cardObj.Roster.DST); j++ {
			cardObj.Roster.DST[j].PrevWeekSeasonContribution = cardObj.Roster.DST[j].ScoreSeason
			cardObj.Roster.DST[j].ScoreWeek = 0
			cardObj.Roster.DST[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(cardObj.Roster.QB); j++ {
			cardObj.Roster.QB[j].PrevWeekSeasonContribution = cardObj.Roster.QB[j].ScoreSeason
			cardObj.Roster.QB[j].ScoreWeek = 0
			cardObj.Roster.QB[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(cardObj.Roster.RB); j++ {
			cardObj.Roster.RB[j].PrevWeekSeasonContribution = cardObj.Roster.RB[j].ScoreSeason
			cardObj.Roster.RB[j].ScoreWeek = 0
			cardObj.Roster.RB[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(cardObj.Roster.TE); j++ {
			cardObj.Roster.TE[j].PrevWeekSeasonContribution = cardObj.Roster.TE[j].ScoreSeason
			cardObj.Roster.TE[j].ScoreWeek = 0
			cardObj.Roster.TE[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(cardObj.Roster.WR); j++ {
			cardObj.Roster.WR[j].PrevWeekSeasonContribution = cardObj.Roster.WR[j].ScoreSeason
			cardObj.Roster.WR[j].ScoreWeek = 0
			cardObj.Roster.WR[j].IsUsedInCardScore = false
		}

		// reset fresh week scoring stats in score obj

		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, newGameweek), cardObj.CardId, cardObj)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", newGameweek), cardObj.CardId, cardObj)
		if err != nil {
			fmt.Println("Error writing to draft token leaderboard")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument("draftTokens", cardObj.CardId, cardObj.Card)
		if err != nil {
			fmt.Println("Error updating draftToken collection")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", cardObj.OwnerId), cardObj.CardId, cardObj.Card)
		if err != nil {
			fmt.Println("Error updating owners cards collection")
			panic(err)
		}

		fmt.Printf("Updated Card %s to week %s\r", cardObj.CardId, newGameweek)
	}
}
