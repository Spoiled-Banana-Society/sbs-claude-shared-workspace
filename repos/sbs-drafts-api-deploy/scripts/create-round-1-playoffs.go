package main

// This file is currently commented out but kept for reference
// Uncomment the code below when needed

// import (
// 	"context"
// 	"fmt"
// 	"strings"
// 	"time"

// 	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
// 	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
// )

// func GetTopTeamsFromEachLeagueRegularSeasonAndWildcards(gameweek string) (leagueWinners map[string]*models.CardScores, cardsInPlayoffs, runnersUp, jackpotWinners, hofWinners []*models.CardScores) {
// 	leagueWinners = make(map[string]*models.CardScores, 0)
// 	cardsInPlayoffs = make([]*models.CardScores, 0)
// 	runnersUp = make([]*models.CardScores, 0)
// 	jackpotWinners = make([]*models.CardScores, 0)
// 	hofWinners = make([]*models.CardScores, 0)
// 	leagues, err := utils.Db.Client.Collection("drafts").Documents(context.Background()).GetAll()
// 	if err != nil {
// 		fmt.Println("Error getting leagues: ", err)
// 		return nil, nil, nil, nil, nil
// 	}

// 	numOfValidLeagues := 0
// 	prevLengthOfCards := 0
// 	for i := 0; i < len(leagues); i++ {
// 		var league models.League
// 		err := leagues[i].DataTo(&league)
// 		if err != nil {
// 			fmt.Println("Error reading data to league: ", err)
// 			return nil, nil, nil, nil, nil
// 		}

// 		leagueId := league.LeagueId
// 		fmt.Println("League Id: ", leagueId)
// 		if !strings.Contains(leagueId, "2024-fast-draft") {
// 			fmt.Println("Found none 2024 league: ", league.LeagueId)
// 			continue
// 		}

// 		data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, gameweek)).Documents(context.Background()).GetAll()
// 		if err != nil {
// 			fmt.Println("Could not get cards for league: ", err)
// 			return nil, nil, nil, nil, nil
// 		}
// 		fmt.Println("Length of snapshot array returned: ", len(data))
// 		if len(data) == 0 {
// 			fmt.Println("This league has no score objects in it: ", leagueId)
// 			continue
// 		}

// 		numOfValidLeagues++
// 		leagueCards := make([]*models.CardScores, 0)
// 		for j := 0; j < len(data); j++ {
// 			var card models.CardScores
// 			err := data[j].DataTo(&card)
// 			if err != nil {
// 				fmt.Println("error reading to cardscore: ", err)
// 				return nil, nil, nil, nil, nil
// 			}
// 			fmt.Println("Adding Card ", card.CardId)
// 			leagueCards = append(leagueCards, &card)
// 		}
// 		fmt.Println("Done adding league cards to array")

// 		for j := 0; j < len(leagueCards)-1; j++ {
// 			for z := 1 + j; z < len(leagueCards); z++ {
// 				if leagueCards[j].ScoreSeason < leagueCards[z].ScoreSeason {
// 					intermediate := leagueCards[j]
// 					leagueCards[j] = leagueCards[z]
// 					leagueCards[z] = intermediate
// 				}
// 			}
// 		}

// 		fmt.Println("Done sorting league cards")

// 		if strings.EqualFold(league.Level, "Hall of Fame") {
// 			hofWinners = append(hofWinners, leagueCards[0])
// 			AddCardTohofWinners(leagueCards[0])
// 		}
// 		leagueWinners[leagueCards[0].CardId] = leagueCards[0]
// 		AddCardToRegularSeasonWinners(leagueCards[0])

// 		if strings.EqualFold(league.LeagueId, "2024-fast-draft-87") || strings.Contains(league.LeagueId, "159") || strings.Contains(league.LeagueId, "187") || strings.Contains(league.LeagueId, "289") || strings.Contains(league.LeagueId, "376") || strings.Contains(league.LeagueId, "424") || strings.Contains(league.LeagueId, "455") || strings.Contains(league.LeagueId, "489") {
// 			jackpotWinners = append(jackpotWinners, leagueCards[0])
// 			AddCardToJackpotWinners(leagueCards[0])
// 			fmt.Println("jackpot league so only added 1 card to playoffs array")
// 			cardsInPlayoffs = append(cardsInPlayoffs, leagueCards[1])
// 		} else {
// 			cardsInPlayoffs = append(cardsInPlayoffs, leagueCards[0])
// 			cardsInPlayoffs = append(cardsInPlayoffs, leagueCards[1])
// 		}

// 		fmt.Println(fmt.Sprintf("Added winner for %s: Card %s with a score of %s", leagueCards[0].Card.LeagueId, leagueCards[0].Card.CardId, leagueCards[0].Card.SeasonScore))
// 		fmt.Println(fmt.Sprintf("Total valid leagues: %d, total cards in playoffs: %d\r", prevLengthOfCards, len(cardsInPlayoffs)))
// 		// if len(cardsInPlayoffs) != prevLengthOfCards+2 && league.LeagueId == "2024-fast-draft-88{
// 		// 	time.Sleep(3 * time.Second)
// 		// }

// 		for j := 2; j < len(leagueCards); j++ {
// 			runnersUp = append(runnersUp, leagueCards[j])
// 		}

// 		prevLengthOfCards = len(cardsInPlayoffs)
// 	}

// 	fmt.Println("total number of valid leagues: ", numOfValidLeagues)
// 	fmt.Println("total cards in playoffs: ", len(cardsInPlayoffs))

// 	return leagueWinners, cardsInPlayoffs, runnersUp, jackpotWinners, hofWinners
// }

// func SortArrayOfCardScoresBySeason(winners []*models.CardScores) []*models.CardScores {
// 	for i := 0; i < len(winners); i++ {
// 		for j := 1 + i; j < len(winners); j++ {
// 			if winners[i].ScoreSeason < winners[j].ScoreSeason {
// 				intermediate := winners[i]
// 				winners[i] = winners[j]
// 				winners[j] = intermediate
// 			}
// 		}
// 	}
// 	return winners
// }

// func ArrayToMap(objects []*models.CardScores) map[string]*models.CardScores {
// 	result := make(map[string]*models.CardScores)

// 	for _, obj := range objects {
// 		result[obj.CardId] = obj
// 	}

// 	return result
// }

// func SortArrayOfCardScoresByWeek(winners []*models.CardScores) []*models.CardScores {
// 	for i := 0; i < len(winners); i++ {
// 		for j := 1 + i; j < len(winners); j++ {
// 			if winners[i].ScoreWeek < winners[j].ScoreWeek {
// 				intermediate := winners[i]
// 				winners[i] = winners[j]
// 				winners[j] = intermediate
// 			}
// 		}
// 	}
// 	return winners
// }

// func GetWildCardTeams(teamArr []*models.CardScores) []*models.CardScores {
// 	wildcardTeams := make([]*models.CardScores, 0)
// 	sortedTeamArray := SortArrayOfCardScoresBySeason(teamArr)

// 	for i := 0; i < 27; i++ {
// 		wildcardTeams = append(wildcardTeams, sortedTeamArray[i])
// 		AddWildcardCardToDb(sortedTeamArray[i])
// 	}

// 	return wildcardTeams
// }

// func GetRaffleWinnersCard() models.CardScores {
// 	cardId := "3248"
// 	var token models.DraftToken
// 	err := utils.Db.ReadDocument("draftTokens", cardId, &token)
// 	if err != nil {
// 		fmt.Println("Error reading raffle winner token")
// 		panic(err)
// 	}

// 	var team models.CardScores
// 	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/scores/2024REG-14/cards", token.LeagueId), cardId, &team)
// 	if err != nil {
// 		fmt.Println("Error reading score obj for raffle winner")
// 		panic(err)
// 	}

// 	AddCardToJackpotWinners(&team)
// 	return team
// }

// func AddCardToRegularSeasonWinners(cardObj *models.CardScores) {
// 	err := utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData/leagueWinners/cards", cardObj.CardId, cardObj)
// 	if err != nil {
// 		panic(err)
// 	}
// }

// func AddCardToJackpotWinners(cardObj *models.CardScores) {
// 	err := utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData/cardsAdvancingStraightToFinals/cards", cardObj.CardId, cardObj)
// 	if err != nil {
// 		panic(err)
// 	}
// }

// func AddCardToPlayoffCards(cardObj *models.CardScores) {
// 	err := utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData/allPlayoffCards/cards", cardObj.CardId, cardObj)
// 	if err != nil {
// 		panic(err)
// 	}
// }

// func AddCardTohofWinners(cardObj *models.CardScores) {
// 	err := utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData/HOFLeagueWinners/cards", cardObj.CardId, cardObj)
// 	if err != nil {
// 		panic(err)
// 	}

// 	err = utils.Db.CreateOrUpdateDocument("draftTokenLeaderboard/2024REG-15/cards", cardObj.CardId, cardObj)
// 	if err != nil {
// 		panic(err)
// 	}
// }

// func AddWildcardCardToDb(cardObj *models.CardScores) {
// 	err := utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData/wildCards/cards", cardObj.CardId, cardObj)
// 	if err != nil {
// 		panic(err)
// 	}
// }

// func CreatePlayoffLeagueDocuments() {
// 	for i := 1; i <= 100; i++ {
// 		leagueId := fmt.Sprintf("2024-live-draft-playoffs-%d", i)
// 		data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/scores/2024REG-15/cards", leagueId)).Documents(context.Background()).GetAll()
// 		if err != nil {
// 			panic(err)
// 		}

// 		leagueCards := make([]*models.CardScores, 0)
// 		owners := make([]models.LeagueUser, 0)
// 		for j := 0; j < len(data); j++ {
// 			var card models.CardScores
// 			err := data[j].DataTo(&card)
// 			if err != nil {
// 				fmt.Println("error reading to cardscore: ", err)
// 				panic(err)
// 			}
// 			leagueCards = append(leagueCards, &card)
// 			owners = append(owners, models.LeagueUser{OwnerId: card.OwnerId, TokenId: card.CardId})
// 		}

// 		league := &models.League{
// 			LeagueId:     leagueId,
// 			DisplayName:  fmt.Sprintf("2024 BBB Playoffs #%d", i),
// 			CurrentUsers: owners,
// 			NumPlayers:   10,
// 			MaxPlayers:   10,
// 			Level:        leagueCards[0].Level,
// 			IsLocked:     true,
// 		}

// 		err = utils.Db.CreateOrUpdateDocument("drafts", leagueId, league)
// 		if err != nil {
// 			panic(err)
// 		}
// 	}
// }

// func CreatePlayoffsWeek1AndSaveRegularSeasonData() {
// 	gameweek := "2024REG-14"
// 	_, playoffs, runnersUp, jackpot, hofWinners := GetTopTeamsFromEachLeagueRegularSeasonAndWildcards(gameweek)

// 	hofDataMap := ArrayToMap(hofWinners)
// 	err := utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData", "hofLeagueWinners", hofDataMap)
// 	if err != nil {
// 		fmt.Println("Error writing hof league winners to db")
// 		panic(err)
// 	}

// 	// err = utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData", "leagueWinners", winners)
// 	// if err != nil {
// 	// 	fmt.Println("Error writing league winners to db")
// 	// 	panic(err)
// 	// }

// 	raffleWinner := GetRaffleWinnersCard()
// 	jackpot = append(jackpot, &raffleWinner)

// 	// jackpotDataMap := ArrayToMap(jackpot)
// 	// err = utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData", "cardsAdvancingStraightToFinals", jackpotDataMap)
// 	// if err != nil {
// 	// 	fmt.Println("Error writing jackpot winners to db")
// 	// 	panic(err)
// 	// }

// 	wildcardTeams := GetWildCardTeams(runnersUp)
// 	playoffs = append(playoffs, wildcardTeams...)

// 	sortedPlayoffTeams := SortArrayOfCardScoresBySeason(playoffs)

// 	// sortedPlayerArray := struct {
// 	// 	SortedPlayoffCards []*models.CardScores
// 	// }{
// 	// 	SortedPlayoffCards: sortedPlayoffTeams,
// 	// }

// 	// err = utils.Db.CreateOrUpdateDocument("2024DraftPlayoffData", "rankedPlayoffCards", sortedPlayerArray)
// 	// if err != nil {
// 	// 	fmt.Println("Error writing ranked playoff teams to database")
// 	// 	panic(err)
// 	// }

// 	leagueNumber := 1
// 	isIncreasing := true

// 	fmt.Println("Number of playoff teams: ", len(sortedPlayoffTeams))

// 	time.Sleep(4 * time.Second)
// 	for i := 0; i < len(sortedPlayoffTeams); i++ {
// 		leagueId := fmt.Sprintf("2024-live-draft-playoffs-%d", leagueNumber)
// 		fmt.Println("LeagueId: ", leagueId)
// 		card := sortedPlayoffTeams[i]
// 		if card.CardId == "3248" {
// 			continue
// 		}
// 		AddCardToPlayoffCards(card)
// 		fmt.Println("Card Score: ", card.ScoreSeason)

// 		card.Card.LeagueId = leagueId
// 		card.Card.LeagueDisplayName = fmt.Sprintf("2024 BBB Playoffs #%d", leagueNumber)

// 		card.Card.SeasonScore = "0"
// 		card.ScoreSeason = 0
// 		card.Card.WeekScore = "0"
// 		card.ScoreWeek = 0

// 		if len(card.Roster.DST) > 0 {
// 			for j := 0; j < len(card.Roster.DST); j++ {
// 				card.Roster.DST[j].PrevWeekSeasonContribution = 0
// 				card.Roster.DST[j].ScoreWeek = 0
// 				card.Roster.DST[j].ScoreSeason = 0
// 				card.Roster.DST[j].IsUsedInCardScore = false
// 			}
// 		}

// 		if len(card.Roster.QB) > 0 {
// 			for j := 0; j < len(card.Roster.QB); j++ {
// 				card.Roster.QB[j].PrevWeekSeasonContribution = 0
// 				card.Roster.QB[j].ScoreWeek = 0
// 				card.Roster.QB[j].ScoreSeason = 0
// 				card.Roster.QB[j].IsUsedInCardScore = false
// 			}
// 		}

// 		if len(card.Roster.RB) > 0 {
// 			for j := 0; j < len(card.Roster.RB); j++ {
// 				card.Roster.RB[j].PrevWeekSeasonContribution = 0
// 				card.Roster.RB[j].ScoreWeek = 0
// 				card.Roster.RB[j].ScoreSeason = 0
// 				card.Roster.RB[j].IsUsedInCardScore = false
// 			}
// 		}

// 		if len(card.Roster.TE) > 0 {
// 			for j := 0; j < len(card.Roster.TE); j++ {
// 				card.Roster.TE[j].PrevWeekSeasonContribution = 0
// 				card.Roster.TE[j].ScoreWeek = 0
// 				card.Roster.TE[j].ScoreSeason = 0
// 				card.Roster.TE[j].IsUsedInCardScore = false
// 			}
// 		}

// 		if len(card.Roster.WR) > 0 {
// 			for j := 0; j < len(card.Roster.WR); j++ {
// 				card.Roster.WR[j].PrevWeekSeasonContribution = card.Roster.WR[j].ScoreSeason
// 				card.Roster.WR[j].ScoreWeek = 0
// 				card.Roster.WR[j].ScoreSeason = 0
// 				card.Roster.WR[j].IsUsedInCardScore = false
// 			}
// 		}

// 		// reset fresh week scoring stats in score obj

// 		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/2024REG-15/cards", leagueId), card.CardId, card)
// 		if err != nil {
// 			fmt.Println("Error writing card to db")
// 			panic(err)
// 		}

// 		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", "2024REG-15"), card.CardId, card)
// 		if err != nil {
// 			fmt.Println("Error writing to draft token leaderboard")
// 			panic(err)
// 		}

// 		err = utils.Db.CreateOrUpdateDocument("draftTokens", card.CardId, card.Card)
// 		if err != nil {
// 			fmt.Println("Error updating draftToken collection")
// 			panic(err)
// 		}

// 		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", leagueId), card.CardId, card.Card)
// 		if err != nil {
// 			fmt.Println("Error writing card to league cards subcollection: ", card.CardId)
// 			panic(err)
// 		}

// 		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", card.OwnerId), card.CardId, card.Card)
// 		if err != nil {
// 			fmt.Println("Error writing card to league cards subcollection: ", card.CardId)
// 			panic(err)
// 		}

// 		if isIncreasing {
// 			if leagueNumber == 100 {
// 				isIncreasing = false
// 			} else {
// 				leagueNumber++
// 			}
// 		} else {
// 			if leagueNumber == 1 {
// 				isIncreasing = true
// 			} else {
// 				leagueNumber--
// 			}
// 		}
// 	}
// }

func main() {
	// This file is currently disabled - all code is commented out
	// Uncomment the functions above and the code in main() when needed
}
