package websockets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/auth"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/models"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"
	"github.com/go-chi/chi"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var (
	// websocketUpgrader is used to upgrade incoming HTTP requests into a persistent websocket connection
	websocketUpgrader = websocket.Upgrader{
		CheckOrigin:      checkOrigin,
		ReadBufferSize:   4096,
		WriteBufferSize:  4096,
		HandshakeTimeout: 500 * time.Second,
	}

	// vercelOriginRe matches any *.vercel.app preview/staging URL.
	vercelOriginRe = regexp.MustCompile(`^https://[a-z0-9-]+\.vercel\.app$`)

	allowedOrigins = []string{
		"https://sbsfantasy.com",
		"https://www.sbsfantasy.com",
		"http://localhost:3000",
		"http://localhost:3001",
	}
)

var (
	ErrEventNotSupported = errors.New("this event type is not supported")
)

// isWalletInDraft returns true if the given wallet (lowercased) is in the
// league's CurrentUsers list. Membership is the spectator gate for private
// drafts: only the 10 players who joined can connect. Best-effort — if
// Firestore is unreachable, we deny rather than fail-open.
func isWalletInDraft(wallet, draftId string) bool {
	wallet = strings.ToLower(strings.TrimSpace(wallet))
	if wallet == "" || draftId == "" {
		return false
	}
	var league models.League
	if err := utils.Db.ReadDocument("drafts", draftId, &league); err != nil {
		fmt.Printf("[ws] membership read failed draft=%s err=%v\n", draftId, err)
		return false
	}
	for _, u := range league.CurrentUsers {
		if strings.EqualFold(u.OwnerId, wallet) {
			return true
		}
	}
	return false
}

// checkOrigin enforces an allowlist on the WebSocket Origin header. Browsers
// always send Origin on cross-origin upgrade requests, so this rejects any
// page that isn't ours from opening a draft socket. Non-browser clients
// (Postman, Cloud Run health checks) don't send Origin and are allowed —
// the JWT check in ServeWS still gates them.
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	if vercelOriginRe.MatchString(origin) {
		return true
	}
	return false
}

type DraftManager struct {
	Id      string
	clients ClientList
	sync.RWMutex

	//event handlers to handle the event types we have
	handlers map[string]EventHandler

	// map of drafts
	draftMap map[string]*Draft
}

func NewManager(ctx context.Context) *DraftManager {
	m := &DraftManager{
		Id:       fmt.Sprintf("manager-%s", uuid.New().String()),
		clients:  make(ClientList),
		handlers: make(map[string]EventHandler),
		draftMap: make(map[string]*Draft),
	}
	m.setupEventHandlers()
	return m
}

func (m *DraftManager) setupEventHandlers() {
	m.handlers[EventReceivePick] = HandleNewPickMessage
	m.handlers[EventReceiveQueueUpdate] = HandleQueueMessage
}

func (m *DraftManager) routeEvent(event Event, c *Client) error {
	if handler, ok := m.handlers[event.Type]; ok {
		if err := handler(event, c); err != nil {
			return err
		}
		return nil
	} else {
		return ErrEventNotSupported
	}
}

func (m *DraftManager) ReturnManagerId() string {
	return m.Id
}

func (m *DraftManager) CleanUpDraft(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	fmt.Printf("Clean up draft called for %s\r", draftId)
	if draftId == "" {
		fmt.Println("no draft Id so we are returning")
		w.WriteHeader(400)
		w.Write([]byte("no draft id was passed in the url params"))
		return
	}

	m.RemoveDraftInstanceFromMap(draftId)

	w.Header().Set("Content-Type", "application/json")
	_, err := w.Write([]byte("cleaned up draft"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (m *DraftManager) ServeWS(w http.ResponseWriter, r *http.Request) {
	// Auth: WebSocket clients can't set custom headers from the browser API,
	// so the Privy JWT comes via ?token=<jwt>. Verify before upgrading so
	// unauthenticated clients get a clean 401 instead of an open socket.
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("missing access token"))
		return
	}
	user, err := auth.VerifyAccessToken(token)
	if err != nil {
		fmt.Printf("[ws] auth failed: %v\n", err)
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("invalid access token"))
		return
	}
	if user.WalletAddress == "" {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("no wallet on token"))
		return
	}

	draftName := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("draftName")))
	if draftName == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("no draft name was passed in the url params"))
		return
	}

	// Membership check: caller's wallet must be in the league's CurrentUsers
	// list. This is the gap the previous TODO comment flagged — without it,
	// any authenticated user could spectate any private draft.
	if !isWalletInDraft(user.WalletAddress, draftName) {
		fmt.Printf("[ws] membership rejected: wallet=%s draft=%s\n", user.WalletAddress, draftName)
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("not a member of this draft"))
		return
	}

	requestData := ClientInfo{
		Address:   user.WalletAddress,
		DraftName: draftName,
	}
	fmt.Printf("[ws] accepted: wallet=%s draft=%s\n", requestData.Address, requestData.DraftName)

	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		errMes := fmt.Sprintf("Error in upgrading websocket connection for %s with error: %v", requestData.Address, err)
		fmt.Println(errMes)
		w.WriteHeader(400)
		w.Write([]byte(errMes))
		return
	}
	fmt.Println("Successfully upgraded the http connection to a websocket connection for ", requestData.Address)

	// create new client
	client, err := NewClient(conn, m, requestData)
	if err != nil {
		errMes := fmt.Sprintf("Error in creating client for address: %s with an error of: %v", requestData.Address, err)
		fmt.Println(errMes)
		// Connection is already upgraded to WebSocket — do NOT write HTTP responses.
		// Just close the WebSocket connection cleanly.
		conn.WriteMessage(1, []byte(errMes))
		conn.Close()
		fmt.Println("WebSocket closed due to client creation error: ", errMes)
		return
	}
	//m.Lock()
	m.addClient(client)
	//m.Unlock()
	fmt.Println("Successfully created client and added them to the draft object")

	// open up to go routines to read and write messages with client
	go client.readMessages()
	go client.writeMessages()

	fmt.Println("Connection created with server for user ", requestData.Address)
}

func (m *DraftManager) addClient(client *Client) {
	m.Lock()
	defer func() {
		m.Unlock()
	}()

	m.clients[client] = true
}

func (m *DraftManager) removeClient(client *Client) {
	m.Lock()
	defer func() {
		m.Unlock()
	}()

	if _, ok := m.clients[client]; ok {
		//close connection
		client.connection.Close()
		if d, ok := m.draftMap[client.draftRoom.draftId]; ok {
			// remove user from draft
			d.removeUserFromRoom(client.address)
		}
		fmt.Printf("removed %s from %s\r", client.address, client.draftName)
		// remove from client map
		delete(m.clients, client)
	}
}

func (m *DraftManager) getOrCreateDraftInstance(data ClientInfo) (*Draft, error) {
	m.Lock()
	fmt.Println("inside of getOrCreateDraftInstance")
	if d, ok := m.draftMap[data.DraftName]; ok {
		m.Unlock()
		fmt.Println("inside of first if statement")
		if d.IsCommplete {
			errMes := fmt.Sprintf("This draft is already complete and the draft room is closing for %s", data.DraftName)
			return nil, fmt.Errorf(errMes)
		}
		return d, nil
	}
	m.Unlock()

	fmt.Println("creating new draft")
	draft, err := NewDraft(data.DraftName, m)
	if err != nil {
		fmt.Println("error in creating draft object: ", err)
		return nil, err
	}

	m.Lock()
	// Double-check: another goroutine may have created it while we were unlocked
	if existing, ok := m.draftMap[data.DraftName]; ok {
		m.Unlock()
		fmt.Println("draft was created by another goroutine, using existing instance")
		return existing, nil
	}
	m.draftMap[data.DraftName] = draft
	m.Unlock()
	fmt.Println("added draft instance to draft map in manager: ", m.Id)

	return draft, nil
}

func (m *DraftManager) RemoveDraftInstanceFromMap(draftId string) {
	m.Lock()
	defer func() {
		m.Unlock()
	}()

	if _, ok := m.draftMap[draftId]; ok {
		// remove from client map
		if len(m.draftMap[draftId].activeUsers) == 0 {
			delete(m.draftMap, draftId)
		} else {
			fmt.Println("THis draft object should not be removed because there are still active users connected to it")
			return
		}
	} else {
		fmt.Println("Unable to find this draft object in the draft map ")
	}
}

// RecoverActiveDrafts scans Firestore for in-progress drafts and resumes them.
// Called on server startup so drafts never stall after a Cloud Run restart or deploy.
// Only checks drafts that have 10 players (numPlayers == 10) and are mid-draft (pickNumber 1-149).
func (m *DraftManager) RecoverActiveDrafts() {
	fmt.Println("[Recovery] Scanning Firestore for in-progress drafts...")

	// Read draft tracker to know the current draft range
	type draftTracker struct {
		CurrentLiveDraftCount int `json:"currentLiveDraftCount"`
		CurrentSlowDraftCount int `json:"currentScheduledDraftCount"`
	}
	var counts draftTracker
	err := utils.Db.ReadDocument("drafts", "draftTracker", &counts)
	if err != nil {
		fmt.Println("[Recovery] Error reading draft tracker: ", err)
		return
	}

	// Only check recent drafts — from 1 to current count for both fast and slow
	maxFast := counts.CurrentLiveDraftCount + 1
	maxSlow := counts.CurrentSlowDraftCount + 1
	fmt.Printf("[Recovery] Checking fast drafts 1-%d, slow drafts 1-%d\n", maxFast, maxSlow)

	resumed := 0
	checkDraft := func(draftId string) {
		var info models.DraftInfo
		err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "info", &info)
		if err != nil || info.DraftId == "" {
			return
		}
		if info.DraftStartTime == 0 || info.CurrentPickNumber >= 150 {
			return
		}
		fmt.Printf("[Recovery] Resuming draft %s (pick %d/150, round %d)\n", draftId, info.CurrentPickNumber, info.CurrentRound)
		draft, err := NewDraftForRecovery(draftId, m)
		if err != nil {
			fmt.Printf("[Recovery] Error resuming %s: %v\n", draftId, err)
			return
		}
		m.Lock()
		m.draftMap[draftId] = draft
		m.Unlock()
		resumed++
	}

	for i := 1; i <= maxFast; i++ {
		checkDraft(fmt.Sprintf("2025-fast-draft-%d", i))
	}
	for i := 1; i <= maxSlow; i++ {
		checkDraft(fmt.Sprintf("2025-slow-draft-%d", i))
	}

	fmt.Printf("[Recovery] Resumed %d active drafts\n", resumed)
}

// WatchdogLoop runs continuously and checks every 5 seconds for stalled drafts.
// If a draft's timer should have expired but hasn't advanced, it force-restarts the timer.
// This ensures no draft ever stalls — even if a goroutine crashes, Redis drops a message,
// or any other unexpected failure occurs.
func (m *DraftManager) WatchdogLoop() {
	fmt.Println("[Watchdog] Starting draft watchdog — checking every 500ms")
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		m.RLock()
		drafts := make([]*Draft, 0, len(m.draftMap))
		for _, d := range m.draftMap {
			drafts = append(drafts, d)
		}
		m.RUnlock()

		now := time.Now().Unix()
		for _, draft := range drafts {
			if draft.IsCommplete {
				continue
			}
			if draft.DraftInfo == nil || draft.DraftInfo.CurrentPickNumber > 150 {
				continue
			}
			if draft.DraftInfo.DraftStartTime == 0 {
				continue // draft hasn't started yet
			}

			timer := draft.CurrentTimer
			if timer == nil {
				// No timer running but draft is active — this is a stall
				// Set a placeholder timer to prevent watchdog from double-starting
				placeholder := &DraftTimer{
					EndOfTurnTimestamp: now + draft.DraftInfo.PickLength + 5,
					currentDrafter:    draft.DraftInfo.CurrentDrafter,
				}
				draft.CurrentTimer = placeholder
				fmt.Printf("[Watchdog] Draft %s has no active timer at pick %d — starting timer for %s\n",
					draft.draftId, draft.DraftInfo.CurrentPickNumber, draft.DraftInfo.CurrentDrafter)
				go StartDraftTimerForCurrentPick(draft.DraftInfo.CurrentDrafter, draft.DraftInfo.PickLength, draft)
				continue
			}

			// Check if the timer should have expired by now (with 2s buffer to let normal flow complete)
			if now > timer.EndOfTurnTimestamp+2 {
				// Set a placeholder to prevent watchdog from stacking timers
				placeholder := &DraftTimer{
					EndOfTurnTimestamp: now + draft.DraftInfo.PickLength + 5,
					currentDrafter:    draft.DraftInfo.CurrentDrafter,
				}
				draft.CurrentTimer = placeholder
				fmt.Printf("[Watchdog] Draft %s timer expired %ds ago but pick %d hasn't advanced — force-restarting timer for %s\n",
					draft.draftId, now-timer.EndOfTurnTimestamp, draft.DraftInfo.CurrentPickNumber, draft.DraftInfo.CurrentDrafter)
				go StartDraftTimerForCurrentPick(draft.DraftInfo.CurrentDrafter, draft.DraftInfo.PickLength, draft)
			}
		}
	}
}

func (m *DraftManager) StartDraftFromAPI(w http.ResponseWriter, r *http.Request) {
	draftId := chi.URLParam(r, "draftId")
	if draftId == "" {
		w.WriteHeader(400)
		w.Write([]byte("no draft name was passed in the url params"))
		return
	}

	// Check if draft instance already exists (WebSocket connection may have created it)
	m.Lock()
	if existing, ok := m.draftMap[draftId]; ok {
		m.Unlock()
		fmt.Printf("Draft %s already exists in map, reusing existing instance\n", draftId)
		data, err := json.Marshal(existing)
		if err != nil {
			fmt.Println("ERROR marshalling draft for resonse: ", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
		return
	}
	m.Unlock()

	draft, err := NewDraft(draftId, m)
	if err != nil {
		fmt.Println("Error creating new draft: ", err)
		w.WriteHeader(400)
		w.Write([]byte(err.Error()))
		return
	}

	m.Lock()
	// Double-check in case another goroutine created it
	if _, ok := m.draftMap[draftId]; !ok {
		m.draftMap[draftId] = draft
	}
	m.Unlock()

	data, err := json.Marshal(draft)
	if err != nil {
		fmt.Println("ERROR marshalling draft for resonse: ", err)
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
