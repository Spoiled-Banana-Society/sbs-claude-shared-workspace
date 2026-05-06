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
	//lastGoodId := "prizeTransferc4e65cd7-7c95-4438-ac99-9b7acb03b0fb"
	unsuccessfulId := "prizeTransfer541807c8-441a-4e8f-9507-54ecdc7428bd"
	// amountThatNeedsToBeAdded := 0.012

	data, err := utils.Db.Client.Collection("owners/0x628913d7ed482aeb13d7c9bae2282b9cd2720b17/transactions").Documents(context.Background()).GetAll()
	if err != nil {
		panic(err)
	}

	totalETH := 0.0

	for i := 0; i < len(data); i++ {
		var tx models.Transaction
		err := data[i].DataTo(&tx)
		if err != nil {
			continue
		}

		if !strings.EqualFold(tx.Type, "prizeTransfer") {
			continue
		}

		if strings.EqualFold(tx.Id, unsuccessfulId) {
			continue
		}

		totalETH = totalETH + (tx.PreviousCardAmount - tx.NewCardAmount)
		fmt.Println("Just added eth from a transaction on ", tx.Date)
	}

	fmt.Println("We should have this much eth: ", totalETH)
	// var tx models.Transaction
	// err = utils.Db.ReadDocument("owners/0x628913d7ed482aeb13d7c9bae2282b9cd2720b17/transactions", lastGoodId, &tx)
	// if err != nil {
	// 	panic(err)
	// }

	// fmt.Println(tx.NewOwner)
	// ownerObj := tx.NewOwner

	// ownerObj.AvailableEthCredit
}
