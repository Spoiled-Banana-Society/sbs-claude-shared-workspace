package models

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

const mintPrice float64 = 0.02 // 0.02 ETH

type OwnerLeague struct {
	LeagueId string `json:"leagueId"`
	CardId   string `json:"cardId"`
}

type WithdrawalTracker map[string]float64

type HasW9Tracker map[string]bool

type PfpInfo struct {
	ImageUrl    string `json:"imageUrl"`
	NftContract string `json:"nftContract"`
	DisplayName string `json:"displayName"`
}

type Owner struct {
	AvailableCredit     float64           `json:"availableCredit"`
	AvailableEthCredit  float64           `json:"availableEthCredit"`
	BlueCheckEmail      string            `json:"blueCheckEmail"`
	HasW9               HasW9Tracker      `json:"hasW9"`
	IsBlueCheckVerified bool              `json:"isBlueCheckVerified"`
	Leagues             []OwnerLeague     `json:"leagues"`
	NumWithdrawals      int               `json:"numWithdrawals"`
	PendingCredit       float64           `json:"pendingCredit"`
	WithdrawnAmount     WithdrawalTracker `json:"withdrawnAmount"`
	PFP                 PfpInfo           `json:"pfp"`
}

func CreateOwnerDocument(ownerId string) (*Owner, error) {
	obj := &Owner{
		AvailableCredit:     0,
		AvailableEthCredit:  0,
		BlueCheckEmail:      "",
		HasW9:               make(HasW9Tracker),
		IsBlueCheckVerified: false,
		Leagues:             make([]OwnerLeague, 0),
		NumWithdrawals:      0,
		PendingCredit:       0,
		WithdrawnAmount:     make(WithdrawalTracker),
		PFP:                 PfpInfo{ImageUrl: "", NftContract: "", DisplayName: ownerId},
	}

	err := utils.Db.CreateOrUpdateDocument("owners", ownerId, &obj)
	if err != nil {
		fmt.Println("Error creating owner object for user: ", err)
		return nil, err
	}

	return obj, nil

}

func roundFloat(val float64, precision uint) float64 {
	ratio := math.Pow(10, float64(precision))
	return math.Round(val*ratio) / ratio
}

func AddEthToOwnerOnMintWithPromoCode(numTokensMinted int, ownerId string) error {
	var owner Owner
	err := utils.Db.ReadDocument("owners", ownerId, &owner)
	if err != nil {
		fmt.Printf("Error reading owners document for %s: %v", ownerId, err)
		return err
	}

	amountToAdd := (mintPrice * 0.025) * float64(numTokensMinted)

	fmt.Printf("Adding %f to %s account because someone minted %d tokens with their promo code", roundFloat(amountToAdd, 5), ownerId, numTokensMinted)

	owner.AvailableEthCredit = roundFloat((owner.AvailableEthCredit + amountToAdd), 5)

	err = utils.Db.CreateOrUpdateDocument("owners", ownerId, &owner)
	if err != nil {
		fmt.Println("Error updating owners document when adding ETH on mint", err)
		return err
	}

	return nil
}

type UserNotificationToken struct {
	OwnerId   string `json:"ownerId"`
	PushToken string `json:"pushToken"`
}

func DeleteUserDataOnRequest(ownerId string) error {
	var owner Owner
	err := utils.Db.ReadDocument("owners", ownerId, &owner)
	if err != nil {
		fmt.Println("Error reading owners document: ", err)
		return err
	}

	owner.BlueCheckEmail = ""
	owner.Leagues = make([]OwnerLeague, 0)

	err = utils.Db.CreateOrUpdateDocument("owners", ownerId, owner)
	if err != nil {
		fmt.Println("ERROR updating owners document: ", err)
		return err
	}

	err = utils.Db.DeleteDocument("promoCodes", ownerId)
	if err != nil {
		fmt.Println("Error deleting promoCodes document for owner: ", err)
		return err
	}

	err = utils.Db.DeleteDocument("notificationTokens", ownerId)
	if err != nil {
		fmt.Println("Error deleting notificationTokens document for owner: ", err)
		return err
	}

	return nil
}

func ReturnOwnerObjectById(ownerId string) (*Owner, error) {
	ownerId = strings.ToLower(ownerId)
	var owner Owner
	err := utils.Db.ReadDocument("owners", ownerId, &owner)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			newOwner, err := CreateOwnerDocument(ownerId)
			if err != nil {
				fmt.Println("ERROR creating new owner document for user: ", err)
				return nil, err
			}
			fmt.Println("Created new owner for ", ownerId)
			owner = *newOwner
		} else {
			fmt.Println("ERror reading owners document for user: ", err)
			return nil, err
		}
	}

	return &owner, nil
}

func UpdatePfpAcrossCollections(ownerId string, owner Owner) error {
	data, err := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			fmt.Println("This owner does not have any usedDraftTokens so we are returning")
			return nil
		}
		fmt.Println("ERRROR reading all usedDraftTokens for owner: ", err)
	}

	var gameweek GameWeekObject
	err = utils.Db.ReadDocument("gameweekTracker", "gameweekNum", &gameweek)
	if err != nil {
		fmt.Println("Gameweek object not returned: ", err)
		return err
	}

	var currentGameweekString string
	if gameweek.WeekNum < 10 {
		currentGameweekString = fmt.Sprintf("2024REG-0%d", gameweek.WeekNum)
	} else {
		currentGameweekString = fmt.Sprintf("2024REG-%d", gameweek.WeekNum)
	}

	for i := 0; i < len(data); i++ {
		var token DraftToken
		err := data[i].DataTo(&token)
		if err != nil {
			fmt.Println("Error reading data in to draftToken: ", err)
			return err
		}

		leagueId := token.LeagueId
		if leagueId == "" {
			fmt.Println("This token should be here: ", token)
			continue
		}

		var cardStats CardScores
		err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, currentGameweekString), token.CardId, &cardStats)
		if err != nil {
			fmt.Println("ERROR reading cardScore document: ", err)
			return err
		}

		cardStats.PFP = owner.PFP

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/scores/%s/cards", leagueId, currentGameweekString), token.CardId, &cardStats)
		if err != nil {
			fmt.Println("ERROR updating card score in league: ", err)
			return err
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("draftTokenLeaderboard/%s/cards", currentGameweekString), token.CardId, &cardStats)
		if err != nil {
			fmt.Println("ERROR updating card score in league: ", err)
			return err
		}
	}

	return nil
}

type GameWeekObject struct {
	WeekNum int `json:"weekNum"`
}

func (o *Owner) UpdatePFPImageAndContract(ownerId, imageUrl, nftContractAddress string) error {
	o.PFP.ImageUrl = imageUrl
	o.PFP.NftContract = nftContractAddress

	err := utils.Db.CreateOrUpdateDocument("owners", ownerId, o)
	if err != nil {
		fmt.Println("ERROR updating owners with new pfp image info: ", err)
		return err
	}

	err = UpdatePfpAcrossCollections(ownerId, *o)
	if err != nil {
		fmt.Println("ERROR updating pfp across collections")
		return err
	}

	return nil
}

// func validateNewDisplayName(displayName string) bool {
// 	isValid := true

// 	acceptableChars := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"

// 	return isValid
// }

func (o *Owner) UpdateDisplayNameForUser(ownerId, displayName string) error {

	if len(displayName) > 15 {
		fmt.Println("The display name passes in was over 15 characters")
		return fmt.Errorf("the display name passed in was over 15 characters")
	}
	o.PFP.DisplayName = displayName

	err := utils.Db.CreateOrUpdateDocument("owners", ownerId, o)
	if err != nil {
		fmt.Println("ERROR updating owners with new display name: ", err)
		return err
	}

	err = UpdatePfpAcrossCollections(ownerId, *o)
	if err != nil {
		fmt.Println("ERROR updating pfp across collections")
		return err
	}

	return nil
}
