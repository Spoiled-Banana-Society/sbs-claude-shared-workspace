package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func GetRoundTwoWinners() (leagueWinners, sortedRoundTwoCards, hofCards []*models.CardScores) {
	gameweek := "2024REG-16"
	leagueWinners = make([]*models.CardScores, 0)
	allCards := make([]*models.CardScores, 0)
	hofCards = make([]*models.CardScores, 0)

	leagueNumber := 1

	for i := 1; i <= 10; i++ {
		leagueId := fmt.Sprintf("2024-round-two-playoffs-%d", leagueNumber)
		fmt.Println("League id: ", leagueId)
		// read all card score object for league
		data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, gameweek)).Documents(context.Background()).GetAll()
		if err != nil {
			fmt.Println("Error reading card scores from ", leagueId)
			panic(err)
		}

		// decode returned data to models.CardScores
		leagueCards := make([]*models.CardScores, 0)
		for j := 0; j < len(data); j++ {
			var card models.CardScores
			err := data[j].DataTo(&card)
			if err != nil {
				fmt.Println("error reading data to card")
				panic(err)
			}

			leagueCards = append(leagueCards, &card)
		}

		sortedLeagueArray := SortArrayOfCardScoresByWeek(leagueCards)

		eliminatedCards := make([]*models.CardScores, 0)
		if sortedLeagueArray[0].ScoreWeek == sortedLeagueArray[1].ScoreWeek {
			card1HighestScoringPlayer := FindHighestScoringPlayerFromCard(sortedLeagueArray[0])
			card2HighestScoringPlayer := FindHighestScoringPlayerFromCard(sortedLeagueArray[1])
			if card1HighestScoringPlayer > card2HighestScoringPlayer {
				leagueWinners = append(leagueWinners, sortedLeagueArray[0])
				eliminatedCards = append(eliminatedCards, sortedLeagueArray[1])
				allCards = append(allCards, sortedLeagueArray[1])
				if strings.EqualFold(strings.ToLower(sortedLeagueArray[1].Level), "Hall of Fame") {
					hofCards = append(hofCards, sortedLeagueArray[1])
				}
			} else {
				leagueWinners = append(leagueWinners, sortedLeagueArray[1])
				eliminatedCards = append(eliminatedCards, sortedLeagueArray[0])
				allCards = append(allCards, sortedLeagueArray[0])
				if strings.EqualFold(strings.ToLower(sortedLeagueArray[0].Level), "Hall of Fame") {
					hofCards = append(hofCards, sortedLeagueArray[0])
				}
			}
		} else {
			leagueWinners = append(leagueWinners, sortedLeagueArray[0])
			eliminatedCards = append(eliminatedCards, sortedLeagueArray[1])
			allCards = append(allCards, sortedLeagueArray[1])
		}

		eliminatedCards = append(eliminatedCards, sortedLeagueArray[2:]...)
		allCards = append(allCards, sortedLeagueArray[2:]...)
		fmt.Println("Length of eliminated cards: ", len(eliminatedCards))
		for j := 0; j < len(eliminatedCards); j++ {
			//fmt.Println("Eliminated card: ", eliminatedCards[j])
			//fmt.Println("All card: ", allCards[len(allCards)-1-j])
			if strings.EqualFold(strings.ToLower(eliminatedCards[j].Level), "Hall of Fame") {
				hofCards = append(hofCards, eliminatedCards[j])
			}
		}

		leagueNumber++
	}

	sortedRoundTwoCards = SortArrayOfCardScoresByWeek(allCards)

	return leagueWinners, sortedRoundTwoCards, hofCards
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

func GetWildCardTeamForFinals(sortedCards, leagueWinners []*models.CardScores) *models.CardScores {
	var wildcardTeam models.CardScores
	for i := 0; i < len(sortedCards); i++ {
		for j := 0; j < len(leagueWinners); j++ {
			if sortedCards[i].CardId != leagueWinners[j].CardId {
				wildcardTeam = *sortedCards[i]
				return &wildcardTeam
			}
		}

		if wildcardTeam.CardId != "" {
			break
		}
	}

	return &wildcardTeam
}

func CreateFinalsLeague() {
	leagueWinners, sortedEliminatedRoundTwoCards, hofCards := GetRoundTwoWinners()

	MoveHofCardsEliminatedFromPlayoffLeaguesToFinalsWeek(hofCards)

	wildcard := GetWildCardTeamForFinals(sortedEliminatedRoundTwoCards, leagueWinners)
	leagueWinners = append(leagueWinners, wildcard)
	fmt.Println("Added wildcard to finals array: ", wildcard.Card)

	PayoutCardsAfterRoundTwo(sortedEliminatedRoundTwoCards, *wildcard)

	teamsAdvancedStraightToFinals := make([]*models.CardScores, 0)

	data, err := utils.Db.Client.Collection("2024DraftPlayoffData/cardsAdvancingStraightToFinals/cards").Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("ERror reading cards that advanced straight to the finals")
		panic(err)
	}

	for i := 0; i < len(data); i++ {
		var obj models.CardScores
		err := data[i].DataTo(&obj)
		if err != nil {
			fmt.Println("Error decoding to cardscore: ", err)
			panic(err)
		}

		teamsAdvancedStraightToFinals = append(teamsAdvancedStraightToFinals, &obj)
	}

	fmt.Println("Num of teams returned for advancing straight to finals: ", len(teamsAdvancedStraightToFinals))

	finalsCards := make([]*models.CardScores, 0)
	finalsCards = append(finalsCards, leagueWinners...)
	finalsCards = append(finalsCards, teamsAdvancedStraightToFinals...)

	newGameweek := "2024REG-17"
	sortedFinalsCards := SortArrayOfCardScoresByWeek(finalsCards)
	fmt.Println("Num of cards being added to finals: ", len(sortedFinalsCards))
	for i := 0; i < len(sortedFinalsCards); i++ {
		leagueId := "2024-live-draft-finals"
		card := sortedFinalsCards[i]

		card.Card.LeagueId = leagueId
		card.Card.LeagueDisplayName = fmt.Sprintf("2024 BBB Finals")

		if !strings.EqualFold(strings.ToLower(card.Level), "Hall of Fame") {
			card.Card.SeasonScore = "0"
			card.ScoreSeason = 0
			card.PrevWeekSeasonScore = 0
			card.PrevWeekSeasonScore = 0
		} else {
			card.PrevWeekSeasonScore = card.ScoreSeason
		}
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

		// reset fresh week scoring stats in score obj

		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, newGameweek), card.CardId, card)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", newGameweek), card.CardId, card)
		if err != nil {
			fmt.Println("Error writing to draft token leaderboard")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument("draftTokens", card.CardId, card.Card)
		if err != nil {
			fmt.Println("Error updating draftToken collection")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", card.OwnerId), card.CardId, card.Card)
		if err != nil {
			fmt.Println("Error updating owner collection")
			panic(err)
		}
	}
}

func MoveHofCardsEliminatedFromPlayoffLeaguesToFinalsWeek(hofCards []*models.CardScores) {
	newGameweek := "2024REG-17"
	leagueId := "2024-hof-playoffs-eliminated-from-reg-playoffs"
	leagueDisplayName := "2024 BBB Hall of Fame Playoffs"

	for i := 0; i < len(hofCards); i++ {
		cardObj := hofCards[i]

		cardObj.Card.LeagueId = leagueId
		cardObj.Card.LeagueDisplayName = leagueDisplayName

		cardObj.Card.WeekScore = "0"
		cardObj.ScoreWeek = 0
		cardObj.PrevWeekSeasonScore = cardObj.ScoreSeason

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
			fmt.Println("Error updating owners collection")
			panic(err)
		}
	}
}

func PayoutCardsAfterRoundTwo(cards []*models.CardScores, wildCard models.CardScores) {
	fmt.Println("Length of cards being paid out: ", len(cards))
	paidCards := 0
	for i := 0; i < len(cards); i++ {
		if wildCard.CardId == cards[i].CardId {
			continue
		}
		card := cards[i].Card
		//fmt.Println("Card being paid out: ", card)

		card.Prizes.ETH += 0.0125

		scoreObj := cards[i]
		scoreObj.Card = card

		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", card.LeagueId, "2024REG-16"), card.CardId, scoreObj)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", "2024REG-16"), card.CardId, scoreObj)
		if err != nil {
			fmt.Println("Error writing to draft token leaderboard")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument("draftTokens", card.CardId, card)
		if err != nil {
			fmt.Println("Error updating draftToken collection")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", card.OwnerId), card.CardId, card)
		if err != nil {
			fmt.Println("Error updating owners collection")
			panic(err)
		}
		fmt.Println(fmt.Sprintf("Paid out card %s 0.0125 ETH", card.CardId))
		fmt.Println("For a total amount of.... ", card.Prizes.ETH)
		paidCards++
	}
	fmt.Println("Paid out this many cards: ", paidCards)
}

func main() {
	utils.NewDatabaseClient(true)
	//CreateFinalsLeague()

	newGameweek := "2024REG-17"
	leagueId := "2024-hof-playoffs-eliminated-from-reg-playoffs"
	leagueDisplayName := "2024 BBB Hall of Fame Playoffs"

	data, err := utils.Db.Client.Collection("draftTokenLeaderboard/2024REG-16/cards").Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error reading drafttokenleaderboard")
		panic(err)
	}

	hofCardsToMove := make([]*models.CardScores, 0)
	for i := 0; i < len(data); i++ {
		var obj models.CardScores
		err := data[i].DataTo(&obj)
		if err != nil {
			panic(err)
		}

		if strings.EqualFold(obj.Card.LeagueId, "2024-hof-playoffs-eliminated-from-reg-playoffs") {
			hofCardsToMove = append(hofCardsToMove, &obj)
		}
	}

	fmt.Println("Length of hof cards: ", len(hofCardsToMove))
	for i := 0; i < len(hofCardsToMove); i++ {
		cardObj := hofCardsToMove[i]

		cardObj.Card.LeagueId = leagueId
		cardObj.Card.LeagueDisplayName = leagueDisplayName

		cardObj.Card.WeekScore = "0"
		cardObj.ScoreWeek = 0
		cardObj.PrevWeekSeasonScore = cardObj.ScoreSeason

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
			fmt.Println("Error updating owners collection")
			panic(err)
		}
	}
}
