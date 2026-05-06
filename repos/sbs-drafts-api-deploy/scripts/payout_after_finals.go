package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

var gameweek = "2024REG-17"

func GetOrderedRegularPlayoffCards() []*models.CardScores {
	leagueId := "2024-live-draft-finals"

	data, err := utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).Documents(context.Background()).GetAll()
	if err != nil {
		panic(err)
	}

	playoffCards := make([]*models.CardScores, 0)
	for i := 0; i < len(data); i++ {
		var card models.CardScores
		err := data[i].DataTo(&card)
		if err != nil {
			panic(err)
		}

		if strings.EqualFold(card.Card.LeagueId, leagueId) {
			playoffCards = append(playoffCards, &card)
		}
	}

	fmt.Println("Length of playoff cards: ", len(playoffCards))

	return SortArrayOfCardScoresByWeek(playoffCards)

}

func GetHOFPlayoffCards() []models.CardScores {
	leaderboard, err := models.ReturnHallOfFamePlayoffLeaderboard(gameweek, "ScoreSeason", "")
	if err != nil {
		panic(err)
	}
	fmt.Println("Length of leaderbaord: ", len(leaderboard.Leaderboard))

	fmt.Println("First Place: ", leaderboard.Leaderboard[0].ScoreSeason)
	return leaderboard.Leaderboard

}

func SortArrayOfCardScoresByWeek(winners []*models.CardScores) []*models.CardScores {
	for i := 0; i < len(winners)-1; i++ {
		for j := 1 + i; j < len(winners); j++ {
			if winners[i].ScoreWeek < winners[j].ScoreWeek {
				intermediate := winners[i]
				winners[i] = winners[j]
				winners[j] = intermediate
			}
		}
	}
	return winners
}

func payoutHOFCards() {
	leaderboard := GetHOFPlayoffCards()

	winner := leaderboard[0]
	winner.Card.Prizes.ETH = winner.Card.Prizes.ETH + 1.3

	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", winner.Card.LeagueId, gameweek), winner.Card.CardId, winner)
	if err != nil {
		fmt.Println("Error writing card to db")
		panic(err)
	}

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek), winner.CardId, winner)
	if err != nil {
		fmt.Println("Error writing to draft token leaderboard")
		panic(err)
	}

	err = utils.Db.CreateOrUpdateDocument("draftTokens", winner.CardId, winner.Card)
	if err != nil {
		fmt.Println("Error updating draftToken collection")
		panic(err)
	}

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", winner.OwnerId), winner.CardId, winner.Card)
	if err != nil {
		fmt.Println("Error updating owners collection")
		panic(err)
	}

	fmt.Println("Paid out hof winner to card ", winner.CardId)
}

func payoutRegularSeasonPlayoffs() {
	leaderboard := GetOrderedRegularPlayoffCards()

	for i := 0; i < len(leaderboard); i++ {
		cardObj := leaderboard[i]
		if i == 0 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 10
		} else if i == 1 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 2.5
		} else if i == 2 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 1.25
		} else if i == 3 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 1
		} else if i == 4 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.75
		} else if i == 5 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.5
		} else if i == 6 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.3
		} else if i == 7 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.2
		} else if i == 8 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.15
		} else if i == 9 {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.1
		} else {
			cardObj.Card.Prizes.ETH = cardObj.Card.Prizes.ETH + 0.05
		}

		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", cardObj.Card.LeagueId, gameweek), cardObj.Card.CardId, cardObj)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek), cardObj.CardId, cardObj)
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
			fmt.Println("Error updating owners collection")
			panic(err)
		}

		fmt.Println(fmt.Sprintf("Paid out Card %s for winning %d place", cardObj.CardId, i+1))
	}

}

func main() {
	utils.NewDatabaseClient(true)
	payoutHOFCards()
	payoutRegularSeasonPlayoffs()

}
