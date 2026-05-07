package models

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type PromoCode struct {
	OwnerId             string `json:"ownerId"`
	PromoCode           string `json:"promoCode"`
	NumberOfUses        int64  `json:"numberOfUses"`
	TimesMintedWithCode int64  `json:"timesMintedWithCode"`
}

func checkForUniquenessOfPromoCode(code string) bool {
	ctx := context.Background()
	iter := utils.Db.Client.Collection("promoCodes").Where("PromoCode", "==", code).Documents(ctx)
	data, err := iter.GetAll()
	if err != nil {
		fmt.Println("Error getting the data from the firestore iter: ", err)
		return false
	}
	if len(data) != 0 {
		return false
	} else {
		return true
	}
}

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateRandomString(length int) string {
	rand.Seed(time.Now().Unix())
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	res := "BBB" + string(b)
	return res
}

func GeneratePromoCodeForOwner(ownerId string) (PromoCode, error) {
	var code string
	for {
		code = generateRandomString(8)
		code = strings.ToLower(code)
		isUnique := checkForUniquenessOfPromoCode(code)
		if isUnique {
			break
		} else {
			fmt.Println("This code is not unique so we are generating a new one")
		}
	}

	promoCode := PromoCode{
		OwnerId:             ownerId,
		PromoCode:           code,
		NumberOfUses:        0,
		TimesMintedWithCode: 0,
	}

	err := utils.Db.CreateOrUpdateDocument("promoCodes", ownerId, &promoCode)
	if err != nil {
		fmt.Printf("Error creating or updating promo code for %s: %v \r", ownerId, err)
		return PromoCode{}, err
	}

	return promoCode, nil
}

func ReturnPromoCodeForUser(ownerId string) (PromoCode, error) {
	var obj PromoCode
	err := utils.Db.ReadDocument("promoCodes", ownerId, &obj)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			obj, err = GeneratePromoCodeForOwner(ownerId)
			if err != nil {
				fmt.Println("Error in generating promo code for owner: ", err)
				return PromoCode{}, err
			} else {
				return obj, nil
			}
		}
		fmt.Println("Error in generating promo code for owner: ", err)
		return PromoCode{}, err
	}

	return obj, nil
}

func (promo PromoCode) UpdatePromoCode(newCode string) error {
	newCode = strings.ToLower(newCode)
	isUnique := checkForUniquenessOfPromoCode(newCode)
	if !isUnique {
		return fmt.Errorf("cannot update promo code because it is not unique")
	}

	promo.PromoCode = newCode

	err := utils.Db.CreateOrUpdateDocument("promoCodes", promo.OwnerId, promo)
	if err != nil {
		fmt.Printf("error updating promo code for %s with error: %v\r", promo.OwnerId, err)
		return err
	}
	return nil
}

func UpdatePromoCodeFromMint(promoCode, minterAddress string, numTokensMinted int64) error {
	ctx := context.Background()
	iter := utils.Db.Client.Collection("promoCodes").Where("PromoCode", "==", strings.ToLower(promoCode)).Documents(ctx)
	data, err := iter.GetAll()
	if err != nil {
		fmt.Println("Error getting data from firestore that matches this promo code: ", err)
		return err
	}

	var promo PromoCode
	err = data[0].DataTo(&promo)
	if err != nil {
		fmt.Println("error getting data from firestore snapshot: ", err)
		return err
	}
	promo.NumberOfUses = promo.NumberOfUses + numTokensMinted

	err = utils.Db.CreateOrUpdateDocument("promoCodes", promo.OwnerId, promo)
	if err != nil {
		fmt.Println("error updating promo code to increment the number of uses for the given promo code: ", err)
		return err
	}

	var minterPromo PromoCode
	err = utils.Db.ReadDocument("promoCodes", minterAddress, &minterPromo)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			minterPromo, err = GeneratePromoCodeForOwner(minterAddress)
			if err != nil {
				fmt.Println("Error in generating promo code for owner: ", err)
				return err
			}
		} else {
			fmt.Println("Error in generating promo code for owner: ", err)
			return err
		}
	}

	minterPromo.TimesMintedWithCode = minterPromo.TimesMintedWithCode + numTokensMinted
	err = utils.Db.CreateOrUpdateDocument("promoCodes", minterPromo.OwnerId, minterPromo)
	if err != nil {
		fmt.Println("error updating promo code to increment the number of uses for the given promo code: ", err)
		return err
	}

	err = AddEthToOwnerOnMintWithPromoCode(int(numTokensMinted), promo.OwnerId)
	if err != nil {
		fmt.Println("error paying ETH for person who's promo code was used: ", err)
		return err
	}

	return nil
}
