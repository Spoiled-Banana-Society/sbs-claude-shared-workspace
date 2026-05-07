package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

/*
	Run this script with go create-round-2-playoffs.go

	This will transition from round 1 of the playoffs to round 2 and pay out the people who won their regular season leagues but got eliminated
*/

func GetRoundOneLeagueWinners() (sortedLeagueWinners, hofCardsEliminated []*models.CardScores) {
	oldGameweek := "2024REG-15"

	leagueWinners := make([]*models.CardScores, 0)
	hofCardsEliminated = make([]*models.CardScores, 0)
	// loop through all 100 playoff leagues to get winners and payout those eliminated
	for i := 1; i <= 100; i++ {
		leagueId := fmt.Sprintf("2024-live-draft-playoffs-%d", i)
		ctx := context.Background()
		data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, oldGameweek)).Documents(ctx).GetAll()
		if err != nil {
			fmt.Println("ERROR reading card scores from ", leagueId)
			panic(err)
		}

		// loop through documents returned and decode them into objects
		leagueCards := make([]*models.CardScores, 0)
		for j := 0; j < len(data); j++ {
			var card models.CardScores
			err := data[j].DataTo(&card)
			if err != nil {
				fmt.Println("Error decoding card")
				panic(err)
			}
			leagueCards = append(leagueCards, &card)
		}

		fmt.Println("Length of league Cards: ", len(leagueCards))
		sortedLeagueTeams := SortArrayOfCardScoresByWeek(leagueCards)
		eliminatedCards := make([]*models.CardScores, 0)
		// add player with highest week score from week 15 to array to get added to round 2
		winner := &models.CardScores{}
		if sortedLeagueTeams[0].ScoreWeek == sortedLeagueTeams[1].ScoreWeek {
			card1HighestScoringPlayer := FindHighestScoringPlayerFromCard(sortedLeagueTeams[0])
			card2HighestScoringPlayer := FindHighestScoringPlayerFromCard(sortedLeagueTeams[1])
			if card1HighestScoringPlayer > card2HighestScoringPlayer {
				winner = sortedLeagueTeams[0]
				leagueWinners = append(leagueWinners, winner)
				eliminatedCards = append(eliminatedCards, sortedLeagueTeams[1])
			} else {
				winner = sortedLeagueTeams[1]
				leagueWinners = append(leagueWinners, winner)
				eliminatedCards = append(eliminatedCards, sortedLeagueTeams[0])
			}
		} else {
			winner = sortedLeagueTeams[0]
			leagueWinners = append(leagueWinners, winner)
			eliminatedCards = append(eliminatedCards, sortedLeagueTeams[1])
		}

		eliminatedCards = append(eliminatedCards, sortedLeagueTeams[2:]...)
		hofCardsEliminated = append(hofCardsEliminated, PayoutCardsAfterRoundOne(eliminatedCards)...)
		fmt.Println(fmt.Sprintf("Winner of %s is Card %s\r", leagueId, winner.CardId))
		//time.Sleep(1 * time.Second)
	}

	// Sort array of league winners by week score
	sortedLeagueWinners = SortArrayOfCardScoresByWeek(leagueWinners)
	return sortedLeagueWinners, hofCardsEliminated
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

func PayoutCardsAfterRoundOne(cards []*models.CardScores) []*models.CardScores {
	// sortedCards := SortArrayOfCardScoresByWeek(cards)
	sortedCards := cards
	regularSeasonWinners := make(map[string]*models.CardScores, 0)
	data, err := utils.Db.Client.Collection("2024DraftPlayoffData/leagueWinners/cards").Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error reading league winners from db")
		panic(err)
	}

	for i := 0; i < len(data); i++ {
		var card models.CardScores
		err := data[i].DataTo(&card)
		if err != nil {
			panic(err)
		}

		regularSeasonWinners[card.CardId] = &card
	}

	if _, ok := regularSeasonWinners["1532"]; !ok {
		panic("why is this card not eliminated")
	}

	hofCardsEliminated := make([]*models.CardScores, 0)

	// loop through the 9 eliminated players from this playoff leagues cards
	for j := 0; j < 1; j++ {
		cardId := sortedCards[j].CardId
		// check if card won their regular season league
		fmt.Println(cardId)
		_, ok := regularSeasonWinners[cardId]
		if cardId == "1532" {
			fmt.Println("Found card 1532: ", ok)
		}
		if ok {
			cardScore := sortedCards[j]
			if cardScore.CardId == "3320" {
				fmt.Println("Skipping because it was already paid out: ", cardScore.CardId)
				continue
			}
			fmt.Println("Beginning eth: ", cardScore.Card.Prizes.ETH)
			cardScore.Card.Prizes.ETH += 0.01

			err := utils.Db.CreateOrUpdateDocument("draftTokens", cardScore.CardId, cardScore.Card)
			if err != nil {
				fmt.Println("Error updating draftToken collection")
				panic(err)
			}

			err = utils.Db.CreateOrUpdateDocument("draftTokenLeaderboard/2024REG-15/cards", cardId, cardScore)
			if err != nil {
				fmt.Println("Error updating drafttoken leaderboard for Card ", cardId)
				panic(err)
			}

			err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", cardScore.OwnerId), cardScore.CardId, cardScore.Card)
			if err != nil {
				fmt.Println("Error updating draftToken collection")
				panic(err)
			}
			fmt.Println(fmt.Sprintf("Paid out 0.01ETH to Card %s for winning regular season but not advancing from %s", cardScore.CardId, cardScore.Card.LeagueId))
		} else {
			fmt.Println("This card did not win its league: ", cardId)
		}

		// track hof cards that are eliminated so that we can still make them an entry on the leaderboard
		if strings.EqualFold(strings.ToLower(sortedCards[j].Level), "Hall of Fame") {
			hofCardsEliminated = append(hofCardsEliminated, sortedCards[j])
		}
	}

	return hofCardsEliminated
}

func FindHighestScoringPlayerFromCard(obj *models.CardScores) float64 {
	highestScore := float64(0)
	if len(obj.Roster.DST) > 0 {
		for i := 0; i < len(obj.Roster.DST); i++ {
			if obj.Roster.DST[i].ScoreWeek > highestScore {
				highestScore = obj.Roster.DST[i].ScoreWeek
			}
		}
	}

	if len(obj.Roster.QB) > 0 {
		for i := 0; i < len(obj.Roster.QB); i++ {
			if obj.Roster.QB[i].ScoreWeek > highestScore {
				highestScore = obj.Roster.QB[i].ScoreWeek
			}
		}
	}

	if len(obj.Roster.RB) > 0 {
		for i := 0; i < len(obj.Roster.RB); i++ {
			if obj.Roster.RB[i].ScoreWeek > highestScore {
				highestScore = obj.Roster.RB[i].ScoreWeek
			}
		}
	}

	if len(obj.Roster.TE) > 0 {
		for i := 0; i < len(obj.Roster.TE); i++ {
			if obj.Roster.TE[i].ScoreWeek > highestScore {
				highestScore = obj.Roster.TE[i].ScoreWeek
			}
		}
	}

	if len(obj.Roster.WR) > 0 {
		for i := 0; i < len(obj.Roster.WR); i++ {
			if obj.Roster.WR[i].ScoreWeek > highestScore {
				highestScore = obj.Roster.WR[i].ScoreWeek
			}
		}
	}
	//fmt.Printf("Highest score for Card %s in league %s: %f\r", obj.CardId, obj.Card.LeagueId, highestScore)

	return highestScore
}

func CreateRoundTwoPlayoffs() {
	newGameweek := "2024REG-16"

	// Get the sorted winners from the round 1 playoff leagues as well as any hof cards that got eliminated this round
	sortedPlayoffTeams, hofCardsEliminated := GetRoundOneLeagueWinners()

	// Pass in the hof cards that were eliminated so that they will still be transitioned to the new week
	MoveHofCardsEliminatedFromPlayoffLeaguesToNewWeek(hofCardsEliminated)

	leagueNumber := 1
	isIncreasing := true

	for i := 0; i < len(sortedPlayoffTeams); i++ {
		leagueId := fmt.Sprintf("2024-round-two-playoffs-%d", leagueNumber)
		card := sortedPlayoffTeams[i]

		// Update the object for the new week
		card.Card.LeagueId = leagueId
		card.Card.LeagueDisplayName = fmt.Sprintf("2024 BBB Playoffs Round Two #%s", leagueNumber)

		// if card is hall of fame then we do not want to zero out their season score
		if !strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
			card.Card.SeasonScore = "0"
			card.ScoreSeason = 0
			card.PrevWeekSeasonScore = 0
		} else {
			card.PrevWeekSeasonScore = card.ScoreSeason
		}
		// reset fresh week scoring stats in score obj
		card.Card.WeekScore = "0"
		card.ScoreWeek = 0

		for j := 0; j < len(card.Roster.DST); j++ {
			if strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
				card.Roster.DST[j].PrevWeekSeasonContribution = card.Roster.DST[j].ScoreSeason
				card.Roster.DST[j].ScoreWeek = 0
			} else {
				card.Roster.DST[j].PrevWeekSeasonContribution = 0
				card.Roster.DST[j].ScoreWeek = 0
				card.Roster.DST[j].ScoreSeason = 0
			}
			card.Roster.DST[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(card.Roster.QB); j++ {
			if strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
				card.Roster.QB[j].PrevWeekSeasonContribution = card.Roster.QB[j].ScoreSeason
				card.Roster.QB[j].ScoreWeek = 0
			} else {
				card.Roster.QB[j].PrevWeekSeasonContribution = 0
				card.Roster.QB[j].ScoreWeek = 0
				card.Roster.QB[j].ScoreSeason = 0
			}
			card.Roster.QB[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(card.Roster.RB); j++ {
			if strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
				card.Roster.RB[j].PrevWeekSeasonContribution = card.Roster.RB[j].ScoreSeason
				card.Roster.RB[j].ScoreWeek = 0
			} else {
				card.Roster.RB[j].PrevWeekSeasonContribution = 0
				card.Roster.RB[j].ScoreWeek = 0
				card.Roster.RB[j].ScoreSeason = 0
			}
			card.Roster.RB[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(card.Roster.TE); j++ {
			if strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
				card.Roster.TE[j].PrevWeekSeasonContribution = card.Roster.TE[j].ScoreSeason
				card.Roster.TE[j].ScoreWeek = 0
			} else {
				card.Roster.TE[j].PrevWeekSeasonContribution = 0
				card.Roster.TE[j].ScoreWeek = 0
				card.Roster.TE[j].ScoreSeason = 0
			}
			card.Roster.TE[j].IsUsedInCardScore = false
		}

		for j := 0; j < len(card.Roster.WR); j++ {
			if strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
				card.Roster.WR[j].PrevWeekSeasonContribution = card.Roster.WR[j].ScoreSeason
				card.Roster.WR[j].ScoreWeek = 0
			} else {
				card.Roster.WR[j].PrevWeekSeasonContribution = 0
				card.Roster.WR[j].ScoreWeek = 0
				card.Roster.WR[j].ScoreSeason = 0
			}
			card.Roster.WR[j].IsUsedInCardScore = false
		}

		// create score obj in round 2 league
		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, newGameweek), card.CardId, card)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", leagueId), card.CardId, card.Card)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		// create leaderboard object in new week
		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", newGameweek), card.CardId, card)
		if err != nil {
			fmt.Println("Error writing to draft token leaderboard")
			panic(err)
		}

		// update draftTokens collection for round 2
		err = utils.Db.CreateOrUpdateDocument("draftTokens", card.CardId, card.Card)
		if err != nil {
			fmt.Println("Error updating draftToken collection")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", card.OwnerId), card.CardId, card.Card)
		if err != nil {
			fmt.Println("Error updating owners subcollection")
			panic(err)
		}

		if isIncreasing {
			if leagueNumber == 10 {
				isIncreasing = false
			} else {
				leagueNumber++
			}
		} else {
			if leagueNumber == 1 {
				isIncreasing = true
			} else {
				leagueNumber--
			}
		}
	}
}

func MoveHofCardsEliminatedFromPlayoffLeaguesToNewWeek(hofCards []*models.CardScores) {
	newGameweek := "2024REG-16"
	leagueId := "2024-hof-playoffs-eliminated-from-reg-playoffs"
	leagueDisplayName := "2024 BBB Hall of Fame Playoffs"

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
	}
}

func main() {
	utils.NewDatabaseClient(true)
	CreateRoundTwoPlayoffs()
}
