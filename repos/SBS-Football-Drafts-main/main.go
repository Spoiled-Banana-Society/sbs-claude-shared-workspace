package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/websockets"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/joho/godotenv"
)

// requireAdminKey gates a handler with the X-Admin-Key header (matches the
// ADMIN_API_KEY env var). Used for admin/system endpoints that mutate the
// draft map. Fails closed if ADMIN_API_KEY is not configured.
func requireAdminKey(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		expected := strings.TrimSpace(os.Getenv("ADMIN_API_KEY"))
		if expected == "" {
			http.Error(w, "ADMIN_API_KEY not configured", http.StatusServiceUnavailable)
			return
		}
		provided := strings.TrimSpace(r.Header.Get("X-Admin-Key"))
		if provided == "" || provided != expected {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

func main() {
	rootCtx := context.Background()
	ctx, cancel := context.WithCancel(rootCtx)
	defer cancel()

	if err := godotenv.Load(".env"); err != nil {
		fmt.Println("ERROR loading in .env file: ", err)
		return
	}

	port := "8000"

	if fromEnv := os.Getenv("PORT"); fromEnv != "" {
		port = fromEnv
	}

	//set up redis connections
	utils.CreateRedisClient()

	// create expo notifications client
	utils.CreateExpoPushClient()

	// set up db connection
	utils.NewDatabaseClient()
	defer func() {
		err := utils.Db.Client.Close()
		if err != nil {
			fmt.Println("Error closing db client in main: ", err)
		}
		err = utils.PubConn.Close()
		if err != nil {
			fmt.Println("Error closing publish redis connection in main: ", err)
		}
		err = utils.SubConn.Close()
		if err != nil {
			fmt.Println("Error closing sub redis connection in main: ", err)
		}
	}()

	r := chi.NewRouter()

	// Reuse incoming X-Request-ID (set by Next.js edge middleware) so the
	// same request shows up under one ID across the frontend, the drafts
	// API, and this WS server. Falls back to a generated ID when missing.
	r.Use(middleware.RequestID)

	manager := websockets.NewManager(ctx)

	// Recovery and watchdog disabled for now — need more testing before enabling
	// go manager.RecoverActiveDrafts()
	// go manager.WatchdogLoop()

	r.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("Connected to server instance %s\r", manager.Id)
	}))
	r.Handle("/ws", http.HandlerFunc(manager.ServeWS))
	// createDraft + cleanUpDraft are admin / system-internal operations
	// that mutate the in-process draft map. Without auth, any internet
	// caller can spawn fake draft instances or wipe live ones (DoS users
	// mid-draft). Gated with the same X-Admin-Key the Go API admin
	// endpoints use.
	r.Post("/draft/{draftId}/createDraft", requireAdminKey(http.HandlerFunc(manager.StartDraftFromAPI)))
	r.Post("/draft/{draftId}/cleanUpDraft", requireAdminKey(http.HandlerFunc(manager.CleanUpDraft)))

	err := http.ListenAndServe(fmt.Sprintf(":%s", port), r)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
