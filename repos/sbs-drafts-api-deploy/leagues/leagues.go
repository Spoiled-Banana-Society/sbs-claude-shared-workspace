package leagues

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
)

type LeagueResources struct{}

func (lr *LeagueResources) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/{draftType}/owner/{ownerId}", lr.joinDraftLeagues)
	r.Get("/getGameweek", lr.ReturnGameweekToUser)
	r.Post("/{draftId}/actions/leave", lr.RemoveUserFromDraft)
	r.Get("/{draftId}/cards/{tokenId}", lr.ReturnDraftToken)
	r.Get("/filledLeagues", lr.ReturnNumberOfFilledLeagues)
	r.Get("/all/{ownerId}/draftTokenLeaderboard/gameweek/{gameweek}/orderBy/{orderBy}/level/{level}", lr.ReturnAllDraftTokenLeaderboard)
	r.Get("/{ownerId}/drafts/{draftId}/leaderboard/{orderBy}/gameweek/{gameweek}", lr.ReturnDraftLeagueLeaderboard)
	r.Get("/{ownerId}/hall-of-fame/leaderboard/{orderBy}/gameweek/{gameweek}", lr.ReturnHallOfFameLeaderboard)
	r.Get("/batchProgress", lr.ReturnBatchProgress)
	return r
}

type JoinLeagueRequestBody struct {
	NumLeaguesToJoin int `json:"numLeaguesToJoin"`
}

const JOIN_LEAGUE_DEADLINE = 1788826800

// route to join draft league
/*
	This route is called when a user wants to join a draft league
	The body is { numLeaguesToJoin: int }
	Draft Type options are fast and slow
	fast: 30 second timer
	slow: 8 hours timer
*/
func (lr *LeagueResources) joinDraftLeagues(w http.ResponseWriter, r *http.Request) {

	ownerId := chi.URLParam(r, "ownerId")
	draftType := chi.URLParam(r, "draftType")
	if ownerId == "" || draftType == "" {
		http.Error(w, "Did not find an ownerid in this request so we are returning", http.StatusInternalServerError)
		return
	}
	ownerId = strings.ToLower(ownerId)

	var req JoinLeagueRequestBody
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		fmt.Println("Error in decoding the request body for joining leagues")
		http.Error(w, "Could not decode the request body into the correct data type so we are returning", http.StatusInternalServerError)
		return
	}

	currentTime := time.Now().Unix()
	if currentTime >= JOIN_LEAGUE_DEADLINE {
		http.Error(w, "You can no longer join drafts. The deadline to join has passed", http.StatusInternalServerError)
		return
	}

	cards, err := models.JoinLeagues(ownerId, req.NumLeaguesToJoin, draftType)
	if err != nil {
		fmt.Println(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(cards)
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

type LeaveRequest struct {
	OwnerId string `json:"ownerId"`
	TokenId string `json:"tokenId"`
}

// route to leave draft league (make sure that the draft has not started or alread happened)
/*
	Body: { ownerId: string, tokenId: string}
	pass in the proper draft id into the url along with this body and this route
	will take a draft card out of the league and add it to their available draft tokens to join drafts
*/
// leaveErrorStatus maps a leave-draft failure to the right HTTP status.
// Expected rejections — the draft already filled, the user isn't in the
// draft, or the draft no longer exists — are client-side 4xx. Only a
// genuine fault is a 500. This keeps the error logs from being flooded
// with false 500s every time someone simply can't leave a draft.
func leaveErrorStatus(err error) int {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "already has 10 members"):
		return http.StatusConflict // 409 — draft is full, can't leave
	case strings.Contains(msg, "not found to be in the current"):
		return http.StatusConflict // 409 — user isn't in this draft
	case strings.Contains(msg, "NotFound"):
		return http.StatusNotFound // 404 — draft doesn't exist
	default:
		return http.StatusInternalServerError // genuine server error
	}
}

func (lr *LeagueResources) RemoveUserFromDraft(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		errMess := fmt.Errorf("no draft id was passed in for this request to leave a league")
		fmt.Println(errMess)
		http.Error(w, errMess.Error(), http.StatusBadRequest)
		return
	}

	var req LeaveRequest
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		fmt.Println("Error in decoding the request body for leaving league")
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err = models.RemoveUserFromDraftWithRTBUpdate(req.TokenId, req.OwnerId, draftId, true)
	if err != nil {
		fmt.Println("Error in removing user from league: ", err)
		http.Error(w, err.Error(), leaveErrorStatus(err))
		return
	}

	data, err := json.Marshal(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// route to return roster/card for user to be used after the draft
func (lr *LeagueResources) ReturnDraftToken(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	tokenId := chi.URLParam(r, "tokenId")
	if draftId == "" || tokenId == "" {
		http.Error(w, "The draftId or TokenID that was passed in were empty", http.StatusBadRequest)
		return
	}

	var t models.DraftToken
	err := t.GetDraftTokenFromDraftById(tokenId, draftId)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(t)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

type NumberOfLeaguesResponse struct {
	NumberOfFilledLeagues int `json:"numberOfFilledLeagues"`
}

func (lr *LeagueResources) ReturnNumberOfFilledLeagues(w http.ResponseWriter, r *http.Request) {
	numLeaguesFilled, err := models.ReturnNumberOfFilledLeagues()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	numLeagues := NumberOfLeaguesResponse{
		NumberOfFilledLeagues: numLeaguesFilled,
	}

	data, err := json.Marshal(&numLeagues)
	if err != nil {
		fmt.Println("ERROR marshalling response data in NumLeagues: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// route to return the leaderboard for draft league
/*
	Returns the leaderboard for a specific draft league for a given gameweek
*/
func (lr *LeagueResources) ReturnDraftLeagueLeaderboard(w http.ResponseWriter, r *http.Request) {
	gameweek := chi.URLParam(r, "gameweek")
	ownerId := chi.URLParam(r, "ownerId")
	orderBy := chi.URLParam(r, "orderBy")
	draftId := chi.URLParam(r, "draftId")
	if gameweek == "" || ownerId == "" || orderBy == "" || draftId == "" {
		fmt.Println("No gameweek, orderBy, or ownerId passed in request")
		http.Error(w, "No gameweek, orderBy, or ownerId passed in request", http.StatusBadRequest)
		return
	}

	leaderboardObject, err := models.ReturnDraftLeagueLeaderboard(gameweek, ownerId, draftId, orderBy)
	if err != nil {
		fmt.Println("ERROR in ReturnDraftLeagueLeaderboard: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(leaderboardObject)
	if err != nil {
		fmt.Println("Error marshalling data: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// route to return leaderboard for all of the draft leagues top scores for a gameweek
func (lr *LeagueResources) ReturnAllDraftTokenLeaderboard(w http.ResponseWriter, r *http.Request) {
	gameweek := chi.URLParam(r, "gameweek")
	ownerId := chi.URLParam(r, "ownerId")
	orderBy := chi.URLParam(r, "orderBy")
	level := chi.URLParam(r, "level")
	if gameweek == "" || ownerId == "" || orderBy == "" || level == "" {
		fmt.Println("No gameweek, orderBy, or ownerId passed in request")
		http.Error(w, "No gameweek, orderBy, or ownerId passed in request", http.StatusBadRequest)
		return
	}

	leaderboardObject, err := models.ReturnAllDraftTokenLeaderboard(gameweek, orderBy, ownerId, level)
	if err != nil {
		fmt.Println("ERROR in ReturnAllDraftTokenLeaderboard: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(leaderboardObject)
	if err != nil {
		fmt.Println("Error marshalling data: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

type GameweekData struct {
	WeekNum int `json:"weekNum"`
}

type GameweekResponse struct {
	Gameweek string `json:"gameweek"`
}

func (lr *LeagueResources) ReturnGameweekToUser(w http.ResponseWriter, r *http.Request) {
	var gameweekData GameweekData
	err := utils.Db.ReadDocument("gameweekTracker", "gameweekNum", &gameweekData)
	if err != nil {
		fmt.Println("ERROR unable to read gameweek document: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var result GameweekResponse
	if gameweekData.WeekNum < 10 {
		result.Gameweek = fmt.Sprintf("2024REG-0%d", gameweekData.WeekNum)
	} else {
		result.Gameweek = fmt.Sprintf("2024REG-%d", gameweekData.WeekNum)
	}

	data, err := json.Marshal(result)
	if err != nil {
		fmt.Println("Error marshalling data: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (lr *LeagueResources) ReturnHallOfFameLeaderboard(w http.ResponseWriter, r *http.Request) {
	gameweek := chi.URLParam(r, "gameweek")
	ownerId := chi.URLParam(r, "ownerId")
	orderBy := chi.URLParam(r, "orderBy")
	if gameweek == "" || ownerId == "" || orderBy == "" {
		fmt.Println("No gameweek, orderBy, or ownerId passed in request")
		http.Error(w, "No gameweek, orderBy, or ownerId passed in request", http.StatusBadRequest)
		return
	}

	leaderboardObject, err := models.ReturnHallOfFamePlayoffLeaderboard(gameweek, orderBy, ownerId)
	if err != nil {
		fmt.Println("ERROR in ReturnHallOfFamePlayoffLeaderboard: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(leaderboardObject)
	if err != nil {
		fmt.Println("Error marshalling data: ", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (lr *LeagueResources) ReturnBatchProgress(w http.ResponseWriter, r *http.Request) {
	batchProgress, err := models.ReturnBatchProgress()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(batchProgress)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

