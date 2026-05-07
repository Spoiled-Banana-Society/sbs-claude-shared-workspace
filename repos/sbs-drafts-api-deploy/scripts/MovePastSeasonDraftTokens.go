package main

import (
	"context"
	"fmt"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
)

func main() {
	ctx := context.Background()
	utils.NewDatabaseClient(true)

	iter := utils.Db.Client.Collection("draftTokens").Documents(ctx)
	defer iter.Stop()

	for {
		doc, err := iter.Next()

		var oldDraftToken models.DraftToken
		if err := doc.DataTo(&oldDraftToken); err != nil {
			fmt.Println("Error writing to oldDraftToken")
			break
		}

		err = utils.Db.CreateOrUpdateDocument("2023DraftTokens", oldDraftToken.CardId, oldDraftToken)
		if err != nil {
			fmt.Println("Error uploading new DT")
			break
		}

		metadata := oldDraftToken.ConvertToMetadata()
		err = utils.Db.CreateOrUpdateDocument("2023DraftTokenMetadata", oldDraftToken.CardId, metadata)
		if err != nil {
			fmt.Println("Error uploading new DT Metadata")
			break
		}
	}
}
