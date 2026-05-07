package draftState

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

type DraftResources struct{}

func (dr *DraftResources) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/{draftId}/playerState/{ownerId}", dr.getPlayersMapWithRankings)
	r.Get("/{draftId}/state/info", dr.getDraftInfoById)
	r.Get("/{draftId}/state/summary", dr.getDraftSummaryById)
	r.Get("/{draftId}/state/connectionList", dr.getDraftConnectionList)
	r.Get("/{draftId}/state/rosters", dr.getRostersMapForDraft)
	r.Get("/{draftId}/cards/{tokenId}", dr.UpdateTokenMetadata)
	r.Post("/{draftId}/cards/updateImagesAndMetadata", dr.UpdateDraftTokenMetadataForCards)
	r.Post("/verifyOwnership", dr.VerifyDraftTokenOwnership)
	r.Post("/{draftId}/actions/createState", dr.CreateEmptyDraftStateForDraft)
	return r
}

// will need to add the stats and analysis that needs to be shown to this route when we have that data
func (dr *DraftResources) getPlayersMapWithRankings(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	draftId := chi.URLParam(r, "draftId")
	if ownerId == "" {
		http.Error(w, "Did not find an ownerId in this request so we are returning", http.StatusBadRequest)
		fmt.Println("Did not find an ownerId in this request so we are returning")
		return
	}
	if draftId == "" {
		http.Error(w, "Did not find an draftId in this request so we are returning", http.StatusBadRequest)
		fmt.Println("Did not find an draftId in this request so we are returning")
		return
	}
	ownerId = strings.ToLower(ownerId)

	res, err := models.ReturnPlayerStateWithRankings(ownerId, draftId)
	if err != nil {
		fmt.Println("ERROR returning player state with rankings: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	fmt.Println("first entry of the array: ", res[0])

	data, err := json.Marshal(res)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// needs to return draft info such as what pick we are on

func (dr *DraftResources) getDraftInfoById(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		http.Error(w, "No draft Id was found in the URL", http.StatusBadRequest)
		return
	}

	info, err := models.ReturnDraftInfoForDraft(draftId)
	if err != nil {
		fmt.Printf("ERROR returning draft info for %s: %v\r", draftId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(info)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// returns the draft summary
func (dr *DraftResources) getDraftSummaryById(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		http.Error(w, "No draft Id was found in the URL", http.StatusBadRequest)
		return
	}

	sum, err := models.ReturnDraftSummaryForDraft(draftId)
	if err != nil {
		fmt.Printf("ERROR returning draft summary for %s: %v\r", draftId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(sum)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// returns map of connection list
func (dr *DraftResources) getDraftConnectionList(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		http.Error(w, "No draft Id was found in the URL", 400)
		return
	}

	cl, err := models.ReturnConnectionListForDraft(draftId)
	if err != nil {
		fmt.Printf("ERROR returning draft connection list for %s: %v\r", draftId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(cl)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// returns rosters for all users in the draft
func (dr *DraftResources) getRostersMapForDraft(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		http.Error(w, "No draft Id was found in the URL", 400)
		return
	}

	rs, err := models.ReturnRostersForDraft(draftId)
	if err != nil {
		fmt.Printf("ERROR returning draft rosters for %s: %v\r", draftId, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(rs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (dr *DraftResources) UpdateTokenMetadata(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		http.Error(w, "No draft Id was found in the URL", 400)
		return
	}
	tokenId := chi.URLParam(r, "tokenId")
	if draftId == "" {
		http.Error(w, "No tokenId was found in the URL", 400)
		return
	}

	var token models.DraftToken
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/cards", draftId), tokenId, &token)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	metadata := token.ConvertToMetadata()
	// err = utils.Db.CreateOrUpdateDocument("draftTokenMetadata", tokenId, metadata)
	// if err != nil {
	// 	http.Error(w, err.Error(), http.StatusInternalServerError)
	// 	return
	// }

	data, err := json.Marshal(metadata)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (dr *DraftResources) UpdateDraftTokenMetadataForCards(w http.ResponseWriter, r *http.Request) {
	data, err := utils.Db.Client.Collection("draftTokens").Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("ERROR getting all draft tokens: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	wg := sync.WaitGroup{}
	ticket := make(chan struct{}, 40)

	for i := 0; i < len(data); i++ {
		obj := data[i]
		var token models.DraftToken
		err = obj.DataTo(&token)
		if err != nil {
			fmt.Println("ERROR reading data to token: ", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			continue
		}

		if token.LeagueId == "" {
			fmt.Println("Card does not have league id: ", token.CardId)
			continue
		}

		cardNum, _ := strconv.ParseInt(token.CardId, 10, 64)

		if models.Environment == "prod" {
			contractOwner, err := utils.Contract.GetOwnerOfToken(int(cardNum))
			if err != nil {
				fmt.Println("error gettinf smart contract owner: ", err)
				continue
			}
			if strings.ToLower(contractOwner) != strings.ToLower(token.OwnerId) {
				fmt.Println("This owner does not match the contract owner for ", token.CardId)
				continue
			}
		}

		ticket <- struct{}{}
		wg.Add(1)
		go func(wg *sync.WaitGroup) {
			defer func() {
				<-ticket
				wg.Done()
			}()
			updatedToken, err := token.UpdateImageURL()
			if err != nil {
				fmt.Println("ERROR updating image URL: ", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			utils.Db.CreateOrUpdateDocument("draftTokens", updatedToken.CardId, updatedToken)
			utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/cards", updatedToken.LeagueId), updatedToken.CardId, updatedToken)

			metadata := updatedToken.ConvertToMetadata()
			err = utils.Db.CreateOrUpdateDocument("draftTokenMetadata", token.CardId, metadata)
			fmt.Println("Updated metadata for Card ", token.CardId)
		}(&wg)
	}
	fmt.Println("Waiting for all cards to finish")
	wg.Wait()

	fmt.Println("Finished running through all tokens")

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write([]byte("Updated draft tokens for all cards"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (dr *DraftResources) VerifyDraftTokenOwnership(w http.ResponseWriter, r *http.Request) {
	err := models.CheckTokenOwnershipForDraftTokens()
	if err != nil {
		fmt.Println("ERROR in VerifyDraftTokenOwnership: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write([]byte("Updated draft tokens and verified owners"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	return
}

func (dr *DraftResources) CreateEmptyDraftStateForDraft(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		http.Error(w, "No draft Id was found in the URL", 400)
		return
	}

	fmt.Println(draftId)
	err := models.CreateLeagueDraftStateUponFilling(draftId, "fast")
	if err != nil {
		fmt.Println("ERROR Creating empty state: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write([]byte("Created draft state"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	return
}
