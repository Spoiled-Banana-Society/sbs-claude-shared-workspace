package leagues

// HTTP surface for password-gated private leagues (ticket-3338). Both routes
// are POST so the password rides the body, never a URL (URLs land in access
// logs). There is deliberately NO list endpoint — a private league is
// reachable only by knowing its id (the /private/{id} link the commissioner
// hands out) AND its password.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/go-chi/chi"
)

type PrivateLeagueRequestBody struct {
	Password string `json:"password"`
	// PassType ('paid'|'free') — join only; same semantics as the public join.
	PassType string `json:"passType,omitempty"`
}

// privateLeagueErrorStatus maps model errors to client-appropriate statuses so
// the page can distinguish "wrong password" from "no pass" from real faults.
func privateLeagueErrorStatus(err error) int {
	msg := err.Error()
	switch {
	case models.ErrIsPrivateLeagueBadPassword(err):
		return http.StatusForbidden
	case models.ErrIsPrivateAlreadyInDraft(err):
		return http.StatusConflict
	case strings.Contains(msg, "code = NotFound"):
		return http.StatusNotFound
	case strings.Contains(msg, "not enough"), strings.Contains(msg, "does not have enough"), strings.Contains(msg, "no valid"):
		// Live-verified message: "not enough paid draft passes: have 0, need 1"
		return http.StatusPaymentRequired // 402 — not enough passes of that type
	default:
		return http.StatusInternalServerError
	}
}

// PrivateLeagueInfo — POST /league/private/{privateId}/info {password}
func (lr *LeagueResources) PrivateLeagueInfo(w http.ResponseWriter, r *http.Request) {
	privateId := strings.ToLower(chi.URLParam(r, "privateId"))
	if privateId == "" {
		http.Error(w, "missing private league id", http.StatusBadRequest)
		return
	}
	var req PrivateLeagueRequestBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "could not decode request body", http.StatusBadRequest)
		return
	}

	info, err := models.GetPrivateLeagueInfo(privateId, req.Password)
	if err != nil {
		if models.ErrIsPrivateLeagueBadPassword(err) {
			// Uniform message for bad password AND unknown league would leak
			// less, but the page needs "wrong password" UX; league ids are
			// non-secret (the link is shared around the group anyway).
			http.Error(w, "incorrect password", http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), privateLeagueErrorStatus(err))
		return
	}

	data, err := json.Marshal(info)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write(data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// JoinPrivateLeague — POST /league/private/{privateId}/join/{ownerId}
// {password, passType}. Response mirrors the public join (an ARRAY with the
// seated card) so the frontend's joinDraft() response mapping works unchanged.
func (lr *LeagueResources) JoinPrivateLeague(w http.ResponseWriter, r *http.Request) {
	privateId := strings.ToLower(chi.URLParam(r, "privateId"))
	ownerId := strings.ToLower(chi.URLParam(r, "ownerId"))
	if privateId == "" || ownerId == "" {
		http.Error(w, "missing private league id or owner id", http.StatusBadRequest)
		return
	}
	var req PrivateLeagueRequestBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "could not decode request body", http.StatusBadRequest)
		return
	}

	// Same season deadline as the public join.
	if time.Now().Unix() >= JOIN_LEAGUE_DEADLINE {
		http.Error(w, "You can no longer join drafts. The deadline to join has passed", http.StatusForbidden)
		return
	}

	card, err := models.JoinPrivateLeague(privateId, ownerId, req.Password, req.PassType)
	if err != nil {
		fmt.Printf("[private-league] join failed league=%s owner=%s: %v\n", privateId, ownerId, err)
		http.Error(w, err.Error(), privateLeagueErrorStatus(err))
		return
	}

	data, err := json.Marshal([]interface{}{card})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write(data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
