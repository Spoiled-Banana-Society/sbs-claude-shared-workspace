package models

import (
	"context"
	"fmt"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/google/uuid"
)

type Transaction struct {
	Id                 string     `json:"id"`
	Type               string     `json:"type"`
	Date               time.Time  `json:"date"`
	PreviousCardAmount float64    `json:"previousCardAmount"`
	NewCardAmount      float64    `json:"newCardAmount"`
	OldCard            DraftToken `json:"oldCard"`
	NewCard            DraftToken `json:"newCard"`
	OldOwner           Owner      `json:"oldOwner"`
	NewOwner           Owner      `json:"newOwner"`
}

func CreateTransferTransaction(oldCard, newCard DraftToken, oldOwner, newOwner Owner) (*Transaction, error) {
	currentTime := time.Now()
	id := uuid.New()
	txId := "prizeTransfer" + id.String()
	tx := &Transaction{
		Id:                 txId,
		Type:               "prizeTransfer",
		Date:               currentTime,
		PreviousCardAmount: oldCard.Prizes.ETH,
		NewCardAmount:      newCard.Prizes.ETH,
		OldCard:            oldCard,
		NewCard:            newCard,
		OldOwner:           oldOwner,
		NewOwner:           newOwner,
	}

	_, err := utils.Db.Client.Collection(fmt.Sprintf("draftTokens/%s/transactions", newCard.CardId)).Doc(txId).Create(context.Background(), tx)
	if err != nil {
		fmt.Println("ERROR creating transaction in draft token: ", err)
		return nil, err
	}

	_, err = utils.Db.Client.Collection(fmt.Sprintf("owners/%s/transactions", newCard.OwnerId)).Doc(txId).Create(context.Background(), tx)
	if err != nil {
		fmt.Println("ERROR creating transaction in owners: ", err)
		return nil, err
	}

	return tx, nil
}
