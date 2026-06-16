package auth

import (
	"net/http"
	"os"
	"strings"
)

// RequireAdminKey gates admin/staging endpoints with X-Admin-Key.
func RequireAdminKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := strings.TrimSpace(os.Getenv("ADMIN_API_KEY"))
		if expected == "" {
			http.Error(w, "ADMIN_API_KEY not configured", http.StatusServiceUnavailable)
			return
		}
		provided := strings.TrimSpace(r.Header.Get("X-Admin-Key"))
		if !constantTimeEqual(provided, expected) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
