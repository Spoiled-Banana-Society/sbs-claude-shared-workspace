package owner

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

type OwnerResources struct{}

func (or *OwnerResources) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/{ownerId}/draftToken/mint", or.CreateTokensInDatabase)
	r.Post("/{ownerId}/drafts/state/rankings", or.UpdateUserRankings)
	r.Get("/{ownerId}/draftToken/all", or.ReturnTokensOwnedByUser)
	r.Get("/{ownerId}/rankings/get", or.ReturnUserRankings)
	r.Get("/{ownerId}/promoCode/get", or.ReturnPromoCode)
	r.Post("/{ownerId}/promoCode/update", or.UpdatePromoCode)
	r.Post("/{ownerId}/mobile/login", or.LogInUserOnMobile)
	r.Post("/{ownerId}/manage/deleteUserData", or.DeleteOwnerData)
	r.Get("/{ownerId}/drafts/{draftId}", or.ReturnCardForOwnerInDraft)
	r.Post("/{ownerId}/metadata/{tokenId}", or.GenerateMetadataForCard)
	r.Get("/{ownerId}", or.ReturnOwnerObjectById)
	r.Post("/{ownerId}/update/pfpImage", or.UpdatePFPImageForUser)
	r.Post("/{ownerId}/update/displayName", or.UpdateDisplayNameForUser)
	r.Post("/{ownerId}/card/{cardId}/actions/prizeTransfer", or.TransferETHFromCardToOwner)
	r.Get("/{ownerId}/drafts/{draftId}/state/queue", or.GetQueueForDraft)
	r.Post("/{ownerId}/drafts/{draftId}/state/queue", or.UpdateQueueForDraft)
	r.Get("/auth/type", or.GetAuthType)
	return r
}

type UserNotificationToken struct {
	OwnerId   string `json:"ownerId"`
	PushToken string `json:"pushToken"`
}

type MobileLoginResponse struct {
	IsLive bool `json:"isLive"`
}

/*
Mobile login route to ensure that anyone logging into the app on mobile is properly set up to receive mobile notifications
Also checks if they already have an owner account or if one needs to be created for a new user
*/
func (or *OwnerResources) LogInUserOnMobile(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		fmt.Println("no OwnerId was found")
		http.Error(w, "Did not find an ownerId in the url path", http.StatusBadRequest)
		return
	}
	ownerId = strings.ToLower(ownerId)

	var owner models.Owner
	err := utils.Db.ReadDocument("owners", ownerId, &owner)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			_, err = models.CreateOwnerDocument(ownerId)
			if err != nil {
				fmt.Println("ERror creating owner document for new user in mobile log in: ", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			fmt.Println("reading owner document in mobile log in: ", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	var reqData UserNotificationToken
	err = json.NewDecoder(r.Body).Decode(&reqData)
	if err != nil {
		fmt.Println("Error decoding request body in mobile login in route: ", err)
		http.Error(w, fmt.Sprint("Error decoding request body in mobile login in route: ", err), http.StatusBadRequest)
		return
	}

	fmt.Println("reqData: ", reqData)
	var userNotiInfo UserNotificationToken
	err = utils.Db.ReadDocument("notificationTokens", ownerId, &userNotiInfo)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			err := utils.Db.CreateOrUpdateDocument("notificationTokens", ownerId, &reqData)
			if err != nil {
				fmt.Println("Error creating notification token document for user: ", err)
				http.Error(w, fmt.Sprint("Error creating notification token document for user: ", err), http.StatusBadRequest)
			}
			return
		} else {
			fmt.Println("Error finding push token for user: ", err)
			http.Error(w, s, http.StatusInternalServerError)
			return
		}
	}

	if reqData.PushToken != userNotiInfo.PushToken {
		fmt.Println("These push tokens do not match so we are updating the database with the new push token")
		err := utils.Db.CreateOrUpdateDocument("notificationTokens", ownerId, &reqData)
		if err != nil {
			fmt.Println("Error creating notification token document for user: ", err)
			http.Error(w, fmt.Sprint("Error creating notification token document for user: ", err), http.StatusBadRequest)
			return
		}
	}

	var response MobileLoginResponse
	err = utils.Db.ReadDocument("draftStatus", "healthCheck", &response)
	if err != nil {
		fmt.Println("ERROR reading in draftStatus/healthCheck: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(response)
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

type MintTokensResponse struct {
	Tokens []models.DraftToken `json:"tokens"`
}

type MintTokensRequestBody struct {
	MinId     int    `json:"minId"`
	MaxId     int    `json:"maxId"`
	PromoCode string `json:"promoCode"`
}

func (or *OwnerResources) CreateTokensInDatabase(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Inside of request")
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		fmt.Println("no OwnerId was found")
		http.Error(w, "Did not find an ownerId in the url path", http.StatusBadRequest)
	}
	ownerId = strings.ToLower(ownerId)

	var request MintTokensRequestBody
	err := json.NewDecoder(r.Body).Decode(&request)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users rankings")
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tokens := make([]models.DraftToken, 0)
	for i := request.MinId; i <= request.MaxId; i++ {
		tokenId := strconv.Itoa(i)
		token, err := models.MintDraftTokenInDb(tokenId, ownerId)
		if err != nil {
			fmt.Println(err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tokens = append(tokens, *token)
	}

	numOfTokensMinted := (request.MaxId - request.MinId) + 1
	if request.PromoCode != "" {
		var code models.PromoCode
		err = utils.Db.ReadDocument("promoCodes", ownerId, &code)
		if err != nil {
			s := err.Error()
			if res := strings.Contains(s, "code = NotFound"); res {
				code, err = models.GeneratePromoCodeForOwner(ownerId)
				if err != nil {
					fmt.Println("Error generating promo code for owner in mint: ", err)
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
			} else {
				fmt.Println("Error reading promocode document: ", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		if strings.ToLower(code.PromoCode) == strings.ToLower(request.PromoCode) {
			fmt.Println("This user is trying to mint using their own promo code")
			http.Error(w, "This user is trying to mint using their own promo code", http.StatusInternalServerError)
			return
		}
		err = models.UpdatePromoCodeFromMint(request.PromoCode, ownerId, int64(numOfTokensMinted))
		if err != nil {
			fmt.Println("Error updating promo code from mint: ", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	res := &MintTokensResponse{
		Tokens: tokens,
	}

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

func (or *OwnerResources) ReturnTokensOwnedByUser(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		http.Error(w, "Did not find an ownerId in the url path", http.StatusInternalServerError)
		return
	}
	ownerId = strings.ToLower(ownerId)

	res, err := models.ReturnAllDraftTokensForOwner(ownerId)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fmt.Println("Returned from getting all draft tokens")

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

func (or *OwnerResources) UpdateUserRankings(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		http.Error(w, "Did not find an ownerId in the url path", http.StatusInternalServerError)
		return
	}
	ownerId = strings.ToLower(ownerId)

	fmt.Println(ownerId)
	var newRankings models.UserRankings
	err := json.NewDecoder(r.Body).Decode(&newRankings)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users rankings")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	updatedRankings := models.UserRankings{
		Ranking: make([]models.PlayerRanking, 0),
	}

	fmt.Printf("New rankings sent in body: %v\r", newRankings.Ranking)
	for i := 0; i < len(newRankings.Ranking); i++ {
		obj := newRankings.Ranking[i]
		obj.Rank = int64(i) + 1
		updatedRankings.Ranking = append(updatedRankings.Ranking, obj)
	}

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", &updatedRankings)
	if err != nil {
		fmt.Println("error in updating the owners rankings in the db")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else {
		fmt.Println("no errors made so rankings should be updated")
	}

	data, err := json.Marshal(updatedRankings)
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

type GetRankingsResponse struct {
	PlayerId string             `json:"playerId"`
	Rank     int64              `json:"rank"`
	Score    float64            `json:"score"`
	Stats    models.StatsObject `json:"stats"`
}

func (or *OwnerResources) ReturnUserRankings(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		http.Error(w, "Did not find an ownerId in the url path", http.StatusInternalServerError)
		return
	}
	ownerId = strings.ToLower(ownerId)

	res, err := models.GetUserRankingsFromDrafts(ownerId)
	if err != nil {
		fmt.Println(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fmt.Println(res)
	stats := models.StatsMap{
		Players: make(map[string]models.StatsObject),
	}
	err = utils.Db.ReadDocument("playerStats2024", "playerMap", &stats)
	if err != nil {
		fmt.Println(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	//fmt.Println(stats.Players)

	//fmt.Println(len(res.Ranking))
	//fmt.Println(stats.Players["PHI-QB"])

	response := make([]GetRankingsResponse, 0)

	for i := 0; i < len(res.Ranking); i++ {
		fmt.Printf("ranking stuff: %v, stats: %v", res.Ranking[i], stats.Players[res.Ranking[i].PlayerId])
		obj := GetRankingsResponse{
			PlayerId: res.Ranking[i].PlayerId,
			Rank:     res.Ranking[i].Rank,
			Score:    res.Ranking[i].Score,
			Stats:    stats.Players[res.Ranking[i].PlayerId],
		}
		response = append(response, obj)
	}

	data, err := json.Marshal(response)
	if err != nil {
		fmt.Println(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (or *OwnerResources) ReturnPromoCode(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		errMess := fmt.Sprintf("No owner id found in URL")
		fmt.Println(errMess)
		http.Error(w, errMess, http.StatusInternalServerError)
	}
	ownerId = strings.ToLower(ownerId)

	promo, err := models.ReturnPromoCodeForUser(ownerId)
	if err != nil {
		errMess := fmt.Sprintf("Error returning promo code for %s with error: %v\r", ownerId, err)
		fmt.Println(errMess)
		http.Error(w, errMess, http.StatusInternalServerError)
	}

	data, err := json.Marshal(promo)
	if err != nil {
		fmt.Println(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

type UpdatePromoRequest struct {
	NewCode string `json:"newCode"`
}

func (or *OwnerResources) UpdatePromoCode(w http.ResponseWriter, r *http.Request) {
	var newCode models.PromoCode
	err := json.NewDecoder(r.Body).Decode(&newCode)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users rankings")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	err = newCode.UpdatePromoCode(newCode.PromoCode)
	if err != nil {
		errMes := fmt.Sprintf("ERROR updating promo code for %s with error: %v\r", newCode.OwnerId, err)
		fmt.Println(errMes)
		http.Error(w, errMes, http.StatusInternalServerError)
	}

	data, err := json.Marshal(newCode)
	if err != nil {
		fmt.Println(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

}

type DeleteResponse struct {
	Result string `json:"result"`
}

func (or *OwnerResources) DeleteOwnerData(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		http.Error(w, "Did not find an ownerId in the url path", http.StatusInternalServerError)
		return
	}
	ownerId = strings.ToLower(ownerId)

	err := models.DeleteUserDataOnRequest(ownerId)
	if err != nil {
		fmt.Println("Error Deleting user data on request: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	res := &DeleteResponse{
		Result: "Successfully deleted all personal data for user",
	}

	data, err := json.Marshal(res)
	if err != nil {
		fmt.Println("Error marshalling anon type: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	fmt.Println("FINISHED DELETING USER DATA FOR ", ownerId)

}

type CardResponse struct {
	Card models.DraftToken `json:"card"`
}

func (or *OwnerResources) ReturnCardForOwnerInDraft(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		http.Error(w, "Did not find an ownerId in the url path", http.StatusInternalServerError)
		return
	}

	draftId := chi.URLParam(r, "draftId")
	if ownerId == "" {
		http.Error(w, "Did not find an draftId in the url path", http.StatusInternalServerError)
		return
	}

	token, err := models.GetCardFromLeagueAndOwner(draftId, ownerId)
	if err != nil {
		fmt.Println("ERROR getting card from league from ownerId: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data := CardResponse{
		Card: *token,
	}

	res, err := json.Marshal(data)
	if err != nil {
		fmt.Println("Error marshalling anon type: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(res)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	fmt.Println("Returning from ReturnCardForOwnerInDraft")
}

func (or *OwnerResources) GenerateMetadataForCard(w http.ResponseWriter, r *http.Request) {
	tokenId := chi.URLParam(r, "tokenId")
	if tokenId == "" {
		http.Error(w, "Did not find an tokenId in the url path", http.StatusInternalServerError)
		return
	}

	var token models.DraftToken
	err := utils.Db.ReadDocument("draftTokens", tokenId, &token)
	if err != nil {
		fmt.Println("Error reading token: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	metadata := token.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocument("draftTokenMetadata", tokenId, metadata)

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write([]byte("generated metadata for card requested"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	return

}

func (or *OwnerResources) ReturnOwnerObjectById(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		fmt.Println("No OwnerId was passed into this route")
		http.Error(w, "No OwnerId was passed into this route", http.StatusBadRequest)
		return
	}
	ownerId = strings.ToLower(ownerId)

	owner, err := models.ReturnOwnerObjectById(ownerId)
	if err != nil {
		fmt.Println("Error returning owner object for user: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(owner)
	if err != nil {
		fmt.Println("ERROR marshalling owner object: ", err)
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

type UpdatePFPImageRequest struct {
	ImageUrl    string `json:"imageUrl"`
	NftContract string `json:"nftContract"`
}

func (or *OwnerResources) UpdatePFPImageForUser(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		fmt.Println("No OwnerId was passed into this route")
		http.Error(w, "No OwnerId was passed into this route", http.StatusBadRequest)
		return
	}
	ownerId = strings.ToLower(ownerId)

	var request UpdatePFPImageRequest
	err := json.NewDecoder(r.Body).Decode(&request)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users pfp image change request: ", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	owner, err := models.ReturnOwnerObjectById(ownerId)
	if err != nil {
		fmt.Println("Error returning owner object for user: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	err = owner.UpdatePFPImageAndContract(ownerId, request.ImageUrl, request.NftContract)
	if err != nil {
		fmt.Println("ERROR updating pfp image and contract address for user: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(owner)
	if err != nil {
		fmt.Println("ERROR marshalling owner object: ", err)
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

type UpdateDisplayNameRequest struct {
	DisplayName string `json:"displayName"`
}

func (or *OwnerResources) UpdateDisplayNameForUser(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		fmt.Println("No OwnerId was passed into this route")
		http.Error(w, "No OwnerId was passed into this route", http.StatusBadRequest)
		return
	}
	ownerId = strings.ToLower(ownerId)

	var request UpdateDisplayNameRequest
	err := json.NewDecoder(r.Body).Decode(&request)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users display name: ", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	owner, err := models.ReturnOwnerObjectById(ownerId)
	if err != nil {
		fmt.Println("Error returning owner object for user: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	err = owner.UpdateDisplayNameForUser(ownerId, request.DisplayName)
	if err != nil {
		fmt.Println("ERROR updating pfp image and contract address for user: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(owner)
	if err != nil {
		fmt.Println("ERROR marshalling owner object: ", err)
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

type PrizeTransferRequest struct {
	DraftId string  `json:"draftId"`
	Amount  float64 `json:"amount"`
}

func (or *OwnerResources) TransferETHFromCardToOwner(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	if ownerId == "" {
		fmt.Println("No OwnerId was passed into this route")
		http.Error(w, "No OwnerId was passed into this route", http.StatusBadRequest)
		return
	}
	ownerId = strings.ToLower(ownerId)

	cardId := chi.URLParam(r, "cardId")
	if cardId == "" {
		fmt.Println("No cardId was passed into this route")
		http.Error(w, "No cardId was passed into this route", http.StatusBadRequest)
		return
	}

	var request PrizeTransferRequest
	err := json.NewDecoder(r.Body).Decode(&request)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users display name: ", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tx, err := models.TransferCreditOffOfDraftToken(cardId, ownerId, request.DraftId, request.Amount)
	if err != nil {
		fmt.Println("ERROR transferring credit to owner: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(tx)
	if err != nil {
		fmt.Println("ERROR marshalling tx object: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	fmt.Printf("Successfully transfered %f from Draft Token %s to %s\r", request.Amount, cardId, ownerId)
}

func (or *OwnerResources) GetQueueForDraft(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	draftId := chi.URLParam(r, "draftId")

	queue, err := models.FetchQueueForDrafter(draftId, ownerId)
	if err != nil {
		fmt.Println("ERROR: Unable to fetch queue", err)
		queue = models.DraftQueue{}
	}

	w.Header().Set("Content-Type", "application/json")
	data, err := json.Marshal(queue)
	if err != nil {
		fmt.Println("ERROR: Unable convert queue to JSON", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (or *OwnerResources) UpdateQueueForDraft(w http.ResponseWriter, r *http.Request) {
	ownerId := chi.URLParam(r, "ownerId")
	draftId := chi.URLParam(r, "draftId")

	var queue models.DraftQueue
	err := json.NewDecoder(r.Body).Decode(&queue)
	if err != nil {
		fmt.Println("Error in decoding the request body for updating this users pfp image change request: ", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	err = models.UpdateQueueForDraft(draftId, ownerId, queue)
	if err != nil {
		// fetch the existing queue so that the front end knows the state to show
		queue, err = models.FetchQueueForDrafter(draftId, ownerId)

		// if we can't fetch either show empty queue to the front end
		if err != nil {
			queue = models.DraftQueue{}
			fmt.Println("ERROR: Unable to update queue")
		}
	}

	w.Header().Set("Content-Type", "application/json")
	data, err := json.Marshal(queue)
	if err != nil {
		fmt.Println("ERROR: Unable convert queue to JSON", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

type AuthType struct {
	localSignin bool `json:"localSignin"`
}

func (or *OwnerResources) GetAuthType(w http.ResponseWriter, r *http.Request) {
	authType := make(map[string]bool)
	// var localSignin bool

	err := utils.Db.ReadDocument("auth", "type", &authType)
	if err != nil {
		fmt.Println("ERROR: Unable to fetch localSignin", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// authType.localSignin = localSignin

	w.Header().Set("Content-Type", "application/json")
	data, err := json.Marshal(authType)
	if err != nil {
		fmt.Println("ERROR: Unable convert queue to JSON", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}
