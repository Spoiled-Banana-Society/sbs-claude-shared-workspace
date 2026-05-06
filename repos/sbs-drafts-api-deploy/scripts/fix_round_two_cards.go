package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func main() {
	utils.NewDatabaseClient(true)

	data, err := utils.Db.Client.Collection("draftTokenLeaderboard/2024REG-16/cards").Documents(context.Background()).GetAll()
	if err != nil {
		panic(err)
	}

	for i := 0; i < len(data); i++ {
		var obj models.CardScores
		err = data[i].DataTo(&obj)
		if err != nil {
			panic(err)
		}

		splitArr := strings.Split(obj.Card.LeagueId, "-")

		leagueNum := splitArr[len(splitArr)-1]
		if strings.EqualFold(leagueNum, "playoffs") {
			continue
		}
		fmt.Println(splitArr[len(splitArr)-1])
		obj.Card.LeagueDisplayName = fmt.Sprintf("2024 BBB Playoffs Round Two #%s", leagueNum)

		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", obj.Card.LeagueId, "2024REG-16"), obj.CardId, obj)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", obj.Card.LeagueId), obj.CardId, obj.Card)
		if err != nil {
			fmt.Println("Error writing card to db")
			panic(err)
		}

		// create leaderboard object in new week
		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", "2024REG-16"), obj.CardId, obj)
		if err != nil {
			fmt.Println("Error writing to draft token leaderboard")
			panic(err)
		}

		// update draftTokens collection for round 2
		err = utils.Db.CreateOrUpdateDocument("draftTokens", obj.CardId, obj.Card)
		if err != nil {
			fmt.Println("Error updating draftToken collection")
			panic(err)
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", obj.OwnerId), obj.CardId, obj.Card)
		if err != nil {
			fmt.Println("Error updating owners subcollection")
			panic(err)
		}
	}
}
