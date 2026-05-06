package models

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type Prizes struct {
	ETH float64 `json:"ETH"`
}

var Environment = os.Getenv("ENVIRONMENT")

type DraftToken struct {
	Roster            *TokenRoster `json:"roster"`
	DraftType         string       `json:"_draftType"`
	CardId            string       `json:"_cardId"`
	ImageUrl          string       `json:"_imageUrl"`
	Level             string       `json:"_level"`
	OwnerId           string       `json:"_ownerId"`
	LeagueId          string       `json:"_leagueId"`
	LeagueDisplayName string       `json:"_leagueDisplayName"`
	Rank              string       `json:"_rank"`
	LeagueRank        string       `json:"_leagueRank"`
	WeekScore         string       `json:"_weekScore"`
	SeasonScore       string       `json:"_seasonScore"`
	Prizes            Prizes       `json:"prizes"`
}

type UsersTokens struct {
	Available []DraftToken `json:"available"`
	Active    []DraftToken `json:"active"`
}

func ReturnAllDraftTokensForOwner(ownerId string) (*UsersTokens, error) {
	res := &UsersTokens{
		Available: make([]DraftToken, 0),
		Active:    make([]DraftToken, 0),
	}

	data, err := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}

	for i := 0; i < len(data); i++ {
		var token DraftToken
		data[i].DataTo(&token)
		tokenNum, err := strconv.Atoi(token.CardId)
		if err != nil {
			// Legacy tokens from the deprecated /staging/mint-tokens endpoint have
			// non-numeric ids like "staging-1771912537015-4". They have no real
			// NFT backing — skip them instead of returning 500 for the whole list.
			fmt.Printf("draftToken/all: skipping non-numeric CardId %q for owner %s\n", token.CardId, ownerId)
			continue
		}
		res.Available = append(res.Available, token)

		// ISSUE this check is brekaing for users with multiple tokens with contract returning no owner
		// TODO re-implement with more stable web3 connection

		if Environment == "no-entry" {
			res, _ := utils.Contract.GetOwnerOfToken(tokenNum)
			if strings.ToLower(token.OwnerId) != strings.ToLower(res) {
				fmt.Println(res)
				fmt.Println(token.OwnerId)
				return nil, fmt.Errorf("the passed in ownerId does not match the ownerId returned from the smart contract for token %s: expected owner(%s) / actual owner(%s)", token.CardId, ownerId, res)
			}

			if strings.ToLower(res) == strings.ToLower(token.OwnerId) {
				fmt.Println("These owners are EQUAL AND WE ARE WORKING")
			} else {
				fmt.Println("THESE ARE NOT MSTCHING")
			}
		}
	}

	data, err = utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}

	for i := 0; i < len(data); i++ {
		var token DraftToken
		data[i].DataTo(&token)
		res.Active = append(res.Active, token)
	}

	return res, nil
}

type Metadata struct {
	Description string                `json:"description"`
	Name        string                `json:"name"`
	Image       string                `json:"image"`
	Attributes  []Attributetrait_type `json:"attributes"`
}

type Attributetrait_type struct {
	Trait_Type string `json:"trait_type"`
	Value      string `json:"value"`
}

func MintDraftTokenInDb(tokenId, ownerId string) (*DraftToken, error) {
	cardNum, _ := strconv.ParseInt(tokenId, 10, 64)
	if Environment == "prod" {
		fmt.Println("Inside of prod")
		contractOwner, _ := utils.Contract.GetOwnerOfToken(int(cardNum))
		if strings.ToLower(contractOwner) != strings.ToLower(ownerId) {
			fmt.Println("This owner does not match the contract owner for ", tokenId)
			return nil, fmt.Errorf("trying to mint a card to a person who does not own it on the smart contract")
		}
		if ownerId == "" || tokenId == "" {
			fmt.Println("ERROR: an empty owner or token id was passed into mintDraftTOken")
			return nil, fmt.Errorf("error an empty owner or token id was passed into MintDraftToken")
		}
	}

	var oldToken DraftToken
	err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), tokenId, &oldToken)
	if err == nil {
		fmt.Printf("The passed in tokenId %s has already been created in the database and thus cannot be minted again\r", tokenId)
		return nil, fmt.Errorf("error this token already exists in the database and cannot be minted again")
	}

	// can hardcode the image to the draft token image we will use before the draft has been complete
	draftToken := &DraftToken{
		Roster:            NewEmptyRoster(strings.ToLower(ownerId)),
		DraftType:         "",
		CardId:            tokenId,
		ImageUrl:          "https://storage.googleapis.com/sbs-draft-token-images/thumbnails/draft-token-image-default_350x490.png",
		Level:             "Pro",
		OwnerId:           strings.ToLower(ownerId),
		LeagueId:          "",
		LeagueDisplayName: "",
		Rank:              "N/A",
		WeekScore:         "0",
		SeasonScore:       "0",
	}

	fmt.Println("Token inside of function: ", draftToken)

	err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenCollectionName(), tokenId, draftToken)
	if err != nil {
		return nil, err
	}
	path := fmt.Sprintf("owners/%s/validDraftTokens", strings.ToLower(ownerId))
	fmt.Println("Path: ", path)
	err = utils.Db.CreateOrUpdateDocument(path, tokenId, draftToken)
	if err != nil {
		fmt.Println("Error updating owner")
		return nil, err
	}
	fmt.Println("Added draft token to ownerid validDraftTokens")

	metadata := draftToken.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenMetadataCollectionName(), tokenId, metadata)
	if err != nil {
		return nil, err
	}

	return draftToken, nil
}

func (dt *DraftToken) ConvertToMetadata() *Metadata {
	return &Metadata{
		Description: "Banana Best Ball, the first ever Web3 Fantasy Football Draft tournament on chain.",
		Name:        fmt.Sprintf("BBB pass #%s", dt.CardId),
		Image:       dt.ImageUrl,
		Attributes:  CreateTokenAttributes(dt),
	}
}

// https://storage.googleapis.com/sbs-fantasy-prod-draft-token-images/thumbnails/draft-token-image_350x490.png

func CreateTokenAttributes(dt *DraftToken) []Attributetrait_type {
	res := make([]Attributetrait_type, 0)
	for i := 0; i < len(dt.Roster.QB); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("QB%d", i+1),
			Value:      dt.Roster.QB[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.RB); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("RB%d", i+1),
			Value:      dt.Roster.RB[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.TE); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("TE%d", i+1),
			Value:      dt.Roster.TE[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.WR); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("WR%d", i+1),
			Value:      dt.Roster.WR[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.DST); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("DST%d", i+1),
			Value:      dt.Roster.DST[i].DisplayName,
		}
		res = append(res, obj)
	}

	levelTrait := Attributetrait_type{
		Trait_Type: "LEVEL",
		Value:      dt.Level,
	}
	res = append(res, levelTrait)

	weekScoreTrait := Attributetrait_type{
		Trait_Type: "WEEK-SCORE",
		Value:      dt.WeekScore,
	}
	res = append(res, weekScoreTrait)

	seasonScoreTrait := Attributetrait_type{
		Trait_Type: "SEASON-SC0RE",
		Value:      dt.SeasonScore,
	}
	res = append(res, seasonScoreTrait)

	rankTrait := Attributetrait_type{
		Trait_Type: "RANK",
		Value:      dt.Rank,
	}
	res = append(res, rankTrait)

	leagueTrait := Attributetrait_type{
		Trait_Type: "LEAGUE-NAME",
		Value:      dt.LeagueDisplayName,
	}
	res = append(res, leagueTrait)

	leagueRankTrait := Attributetrait_type{
		Trait_Type: "LEAGUE-RANK",
		Value:      dt.LeagueRank,
	}
	res = append(res, leagueRankTrait)

	prizesTrait := Attributetrait_type{
		Trait_Type: "PRIZES",
		Value:      fmt.Sprintf("%f ETH", dt.Prizes.ETH),
	}
	res = append(res, prizesTrait)

	return res
}

func (token *DraftToken) GetDraftTokenFromDraftById(tokenId, draftId string) error {
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/cards", draftId), tokenId, token)
	if err != nil {
		return err
	}
	return nil
}

// UpdateInUseDraftTokenInDatabase is the exported wrapper for staging package access.
func (token *DraftToken) UpdateInUseDraftTokenInDatabase(draftId string) error {
	return token.updateInUseDraftTokenInDatabase(draftId)
}

func (token *DraftToken) updateInUseDraftTokenInDatabase(draftId string) error {
	if token.LeagueId == "" {
		token.LeagueId = draftId
	}
	err := utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenCollectionName(), token.CardId, token)
	if err != nil {
		return err
	}

	if token.LeagueId == "" {
		token.LeagueId = draftId
	}
	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId, token)
	if err != nil {
		return err
	}
	if token.LeagueId == "" {
		token.LeagueId = draftId
	}
	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", token.LeagueId), token.CardId, token)
	if err != nil {
		return err
	}

	metadata := token.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenMetadataCollectionName(), token.CardId, metadata)
	if err != nil {
		return err
	}

	return nil
}

func (token *DraftToken) RemoveTokenFromLeague() error {
	oldLeagueId := token.LeagueId
	token.LeagueId = ""
	token.DraftType = ""
	token.LeagueDisplayName = ""
	err := utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenCollectionName(), token.CardId, token)
	if err != nil {
		return err
	}

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/validDraftTokens", token.OwnerId), token.CardId, token)
	if err != nil {

		return err
	}
	fmt.Println("Added card to valid draft tokens upon leaving draft at location: ", fmt.Sprintf("owners/%s/validDraftTokens", token.OwnerId))

	err = utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId)
	if err != nil {
		fmt.Println("error when deleting document in owners")
		return err
	}

	fmt.Printf("drafts/%s/cards/%s", oldLeagueId, token.CardId)
	err = utils.Db.DeleteDocument(fmt.Sprintf("drafts/%s/cards", oldLeagueId), token.CardId)
	if err != nil {
		fmt.Println("error when deleting token from draft league: ", err)
		return err
	}

	metadata := token.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenMetadataCollectionName(), token.CardId, metadata)
	if err != nil {
		return err
	}

	return nil

}

type ImageGeneratorRequest struct {
	Card DraftToken `json:"card"`
}

func (token *DraftToken) UpdateImageURL() (*DraftToken, error) {
	requestBody := &ImageGeneratorRequest{
		Card: *token,
	}

	data, err := json.Marshal(requestBody)
	if err != nil {
		fmt.Println("ERROR marhsalling request body: ", err)
		return nil, err
	}

	r, err := http.NewRequest("POST", "https://us-central1-sbs-prod-env.cloudfunctions.net/draft-image-generator", bytes.NewBuffer(data))
	if err != nil {
		fmt.Println("Error creating post request object")
		return nil, err
	}

	r.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	res, err := client.Do(r)
	if err != nil {
		fmt.Println("error completing the post request to update the card to have a new card image url: ", err)
		return nil, err
	}

	defer res.Body.Close()

	var UpdatedDraftToken DraftToken

	err = json.NewDecoder(res.Body).Decode(&UpdatedDraftToken)
	if err != nil {
		fmt.Println("error decoding the resonse from the image generator api:  ", err)
		return nil, err
	}

	return &UpdatedDraftToken, nil
}

func CheckTokenOwnershipForDraftTokens() error {
	numTokensMinted, err := utils.Contract.GetNumTokensMinted()
	if err != nil {
		fmt.Println("Error getting number of tokens minted from smart contract: ", err)
		return err
	}

	fmt.Println("NumTokensMinted: ", numTokensMinted)

	for i := 0; i < numTokensMinted; i++ {
		var token DraftToken
		err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), fmt.Sprintf("%d", i), &token)
		if err != nil {
			s := err.Error()
			if res := strings.Contains(s, "code = NotFound"); res {
				ownerId, err := utils.Contract.GetOwnerOfToken(i)
				if err != nil {
					fmt.Println("ERROR getting owner of token: ", err)
					return err
				}

				_, err = MintDraftTokenInDb(fmt.Sprintf("%d", i), strings.ToLower(ownerId))
				if err != nil {
					fmt.Println("Error minting draft token: ", err)
					return err
				}
				fmt.Printf("minted Token %d into database because the card is owned at the smart contract level and not in our database\r", i)
				continue
			}
		}

		contractOwner, err := utils.Contract.GetOwnerOfToken(i)
		if err != nil {
			fmt.Println("ERROR in getting contract owner: ", err)
			return err
		}

		if strings.EqualFold(strings.ToLower(contractOwner), strings.ToLower(token.OwnerId)) {
			continue
		}

		token.OwnerId = strings.ToLower(contractOwner)
		err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenCollectionName(), token.CardId, &token)
		if err != nil {
			fmt.Println("ERROR updating token to new owner: ", err)
			return err
		}
	}

	fmt.Println("FInishsed updating owners for draft tokens")
	return nil
}

func round(num float64) int {
	return int(num + math.Copysign(0.5, num))
}

func toFixed(num float64, precision int) float64 {
	output := math.Pow(10, float64(precision))
	return float64(round(num*output)) / output
}

func TransferCreditOffOfDraftToken(cardId, ownerId, draftId string, amount float64) (*Transaction, error) {
	var token DraftToken
	err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), cardId, &token)
	if err != nil {
		fmt.Println("Error reading draft token in transfer route: ", err)
		return nil, err
	}
	if token.Prizes.ETH < amount {
		fmt.Printf("%s is trying to transfer more eth than is on Card %s", ownerId, cardId)
		return nil, fmt.Errorf("%s is trying to transfer more eth than is on Card %s", ownerId, cardId)
	}

	var owner Owner
	err = utils.Db.ReadDocument("owners", ownerId, &owner)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			newOwner, err := CreateOwnerDocument(ownerId)
			if err != nil {
				fmt.Println("ERror creating owner document for owner that does not have an owner document: ", err)
				return nil, err
			}
			fmt.Println("Created a fresh owner document in prize transfer for ", ownerId)
			owner = *newOwner
		} else {
			fmt.Println("Error reading owners document in transfer route: ", err)
			return nil, err
		}
	}

	cardNum, err := strconv.ParseInt(cardId, 10, 64)
	if err != nil {
		fmt.Println("COULD not parse card id to int")
	}

	if Environment == "prod" {
		contractOwner, _ := utils.Contract.GetOwnerOfToken(int(cardNum))
		if strings.ToLower(ownerId) != strings.ToLower(contractOwner) {
			fmt.Println("This owner is not the owner of this token")
			return nil, fmt.Errorf("this user is not the owner of this token")
		}
	}

	oldCard := token
	oldOwner := owner

	owner.AvailableEthCredit = toFixed(owner.AvailableEthCredit+amount, 5)
	token.Prizes.ETH = toFixed(token.Prizes.ETH-amount, 5)

	err = token.updateInUseDraftTokenInDatabase(draftId)
	if err != nil {
		fmt.Println("ERROR updating draft token after transferring eth: ", err)
		return nil, err
	}

	err = utils.Db.CreateOrUpdateDocument("owners", ownerId, owner)
	if err != nil {
		fmt.Println("ERROR updating owner in transfer: ", err)
		token.Prizes.ETH = math.Round((token.Prizes.ETH+amount)*100) / 100
		err = token.updateInUseDraftTokenInDatabase(draftId)
		if err != nil {
			fmt.Println("ERROR adding eth back to token after an error in owner update: ", err)
			return nil, err
		}
		return nil, err
	}

	tx, err := CreateTransferTransaction(oldCard, token, oldOwner, owner)
	if err != nil {
		fmt.Println("ERROR creating transfer transaction: ", err)
		return nil, err
	}
	fmt.Printf("Successfully transfered %f from Draft Token %s to %s", amount, cardId, ownerId)

	return tx, nil
}
