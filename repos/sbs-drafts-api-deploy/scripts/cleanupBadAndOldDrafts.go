package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func MoveOldDraftsToNewCollection() {
	utils.NewDatabaseClient(true)
	data, err := utils.Db.Client.Collection("drafts").Documents(context.Background()).GetAll()
	if err != nil {
		panic(err)
	}

	fmt.Println("Looping through leagues")
	for i := 0; i < len(data); i++ {
		var league models.League
		err = data[i].DataTo(&league)
		if err != nil {
			panic(err)
		}

		fmt.Println("Found ", league.LeagueId)
		splitArr := strings.Split(league.LeagueId, "-")
		if splitArr[0] == "2024" {
			continue
		}
		fmt.Println(league.LeagueId)
	}
}

func RemoveBadDraftsFromThisSeason(l models.League) error {
	data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", l.LeagueId)).Documents(context.Background()).GetAll()
	if err != nil {
		return err
	}

	for i := 0; i < len(data); i++ {
		err = utils.Db.DeleteDocument(fmt.Sprintf("drafts/%s/state", l.LeagueId), data[i].Ref.ID)
		if err != nil {
			fmt.Println("ERROR deleting document for ", data[i].Ref.ID)
			return err
		}
	}

	data, err = utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/cards", l.LeagueId)).Documents(context.Background()).GetAll()
	if err != nil {
		return err
	}

	fmt.Println("Number of cards returned: ", len(data))

	for i := 0; i < len(data); i++ {
		var token models.DraftToken
		err = data[i].DataTo(&token)
		if err != nil {
			return nil
		}
		fmt.Println("Deleting Card ", token.CardId)
		err = utils.Db.DeleteDocument(fmt.Sprintf("drafts/%s/cards", l.LeagueId), data[i].Ref.ID)
		if err != nil {
			fmt.Println("ERROR deleting document for ", data[i].Ref.ID)
			return err
		}

		err = utils.Db.DeleteDocument("draftTokens", token.CardId)
		if err != nil {
			return err
		}

		err = utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId)
		if err != nil {
			return err
		}

		fmt.Println("Deleted all evidence of Card ", token.CardId)
	}

	err = utils.Db.DeleteDocument("drafts", l.LeagueId)
	if err != nil {
		return err
	}

	fmt.Println("Deleted league and all subcollections: ", l.LeagueId)

	return nil
}

// func main() {
// 	utils.NewDatabaseClient(true)
// 	fmt.Println("cleaning up bad drafts")

// 	badLeagueIds := []string{"2024-fast-draft-291", "2024-fast-draft-260", "2024-fast-draft-210", "2024-fast-draft-130", "2024-fast-draft-356"}

// 	for i := 0; i < len(badLeagueIds); i++ {
// 		var l models.League
// 		err := utils.Db.ReadDocument("drafts", badLeagueIds[i], &l)
// 		if err != nil {
// 			panic(err)
// 		}

// 		fmt.Println("league: ", l)
// 		err = RemoveBadDraftsFromThisSeason(l)
// 		if err != nil {
// 			panic(err)
// 		}
// 	}
// }

func main() {
	utils.NewDatabaseClient(true)
	fmt.Println("deleting first 30 cards")

	for i := 0; i < 30; i++ {
		cardId := strconv.Itoa(i)

		var token models.DraftToken
		err := utils.Db.ReadDocument("draftTokens", cardId, &token)
		if err != nil {
			panic(err)
		}

		fmt.Println("Deleting Card ", token.CardId)
		err = utils.Db.DeleteDocument(fmt.Sprintf("drafts/%s/cards", token.LeagueId), cardId)
		if err != nil {
			fmt.Println("ERROR deleting document for ", cardId)
			panic(err)
		}

		err = utils.Db.DeleteDocument("draftTokens", token.CardId)
		if err != nil {
			panic(err)
		}

		err = utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId)
		if err != nil {
			panic(err)
		}

		fmt.Println("Deleted all evidence of Card ", token.CardId)

	}
}
