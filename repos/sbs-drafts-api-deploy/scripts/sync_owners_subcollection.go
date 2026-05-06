package main

import (
	"context"
	"fmt"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func main() {
	utils.NewDatabaseClient(true)

	data, err := utils.Db.Client.Collection("draftTokenLeaderboard/2024REG-16/cards").Documents(context.Background()).GetAll()
	if err != nil {
		panic(err)
	}

	fmt.Println(len(data))
	for i := 0; i < len(data); i++ {
		var card models.CardScores
		err = data[i].DataTo(&card)
		if err != nil {
			panic(err)
		}

		if card.CardId == "2617" {
			fmt.Println("Found the card")
			fmt.Printf("Owner passed in: %s, CardId passed in: %s, Card: %v", card.OwnerId, card.CardId, card)
		}
		if card.OwnerId != card.Card.OwnerId {
			fmt.Println("This card has messed up owners: ", card.CardId)
		}
		err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", card.Card.OwnerId), card.CardId, card.Card)
		if err != nil {
			panic(err)
		}

	}
}
