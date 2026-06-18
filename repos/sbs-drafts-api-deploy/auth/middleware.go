package auth

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi"
)

// AuthEnabled reads DRAFTS_API_AUTH_ENABLED (default false).
func AuthEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("DRAFTS_API_AUTH_ENABLED")), "true")
}

func constantTimeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// RequireServiceKey gates BFF → Go calls with X-SBS-Service-Key.
func RequireServiceKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := strings.TrimSpace(os.Getenv("DRAFTS_API_SERVICE_KEY"))
		if expected == "" {
			http.Error(w, "DRAFTS_API_SERVICE_KEY not configured", http.StatusServiceUnavailable)
			return
		}
		provided := strings.TrimSpace(r.Header.Get("X-SBS-Service-Key"))
		if !constantTimeEqual(provided, expected) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireWalletMatchesOwner ensures X-SBS-Wallet matches {ownerId} in the path.
func RequireWalletMatchesOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ownerId := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "ownerId")))
		wallet := strings.ToLower(strings.TrimSpace(r.Header.Get("X-SBS-Wallet")))
		if ownerId == "" || wallet == "" || wallet != ownerId {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireWalletMatchesBodyOwner ensures X-SBS-Wallet matches ownerId in the JSON body.
// Used for routes like leave where ownerId is in the body, not the path.
func RequireWalletMatchesBodyOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wallet := strings.ToLower(strings.TrimSpace(r.Header.Get("X-SBS-Wallet")))
		if wallet == "" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 4096))
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		var req struct {
			OwnerId string `json:"ownerId"`
		}
		if len(bodyBytes) > 0 {
			if err := json.Unmarshal(bodyBytes, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
		}

		ownerId := strings.ToLower(strings.TrimSpace(req.OwnerId))
		if ownerId == "" || ownerId != wallet {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAutoDraftSecret gates Cloud Tasks auto-draft callbacks.
func RequireAutoDraftSecret(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := strings.TrimSpace(os.Getenv("AUTO_DRAFT_SECRET"))
		if expected == "" {
			http.Error(w, "AUTO_DRAFT_SECRET not configured", http.StatusServiceUnavailable)
			return
		}
		provided := strings.TrimSpace(r.Header.Get("X-Auto-Draft-Secret"))
		if !constantTimeEqual(provided, expected) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
