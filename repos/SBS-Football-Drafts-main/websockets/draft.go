package websockets

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/models"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"

	"github.com/go-redis/redis/v8"
)

type RedisChannels struct {
	DraftChannelName string
	DraftChannel     *redis.PubSub
}

type Players struct {
	Players map[string]models.PlayerInfo
}

type DBConnectionList struct {
	ConnectionList map[string]bool
}

type MessageHandler func(utils.RedisMessage)

type MessageManager map[string]MessageHandler

type Draft struct {
	// Name of draft room for league
	draftId string

	// unix timestamp when the draft starts
	StartTime int64

	// map of address that will return whether a user is connected or not. Will be updated via redis channel
	userConnectionStatus map[string]bool

	// active users connected so we can loop through and write messages to all clients
	activeUsers map[string]*Client

	// instance of the draft manager to be able to delete the draft instance when there are no people connected to it
	draftManager *DraftManager

	RedisChannels *RedisChannels

	RedisManager MessageManager

	DraftInfo *models.DraftInfo

	// map of players and their draft state
	Players map[string]*models.PlayerInfo

	// boolean that will be true if this draft object is the one running the start draft function so that we don't clean up the draft object too early
	IsGM bool

	// shows whether the draft is complete or not
	IsCommplete bool

	// timer
	CurrentTimer *DraftTimer

	sync.RWMutex
}

type ConnectionList struct {
	List map[string]bool `json:"list"`
}

func CreateConnectionList(cl map[string]bool) *ConnectionList {
	return &ConnectionList{
		List: cl,
	}
}

func (cl *ConnectionList) UpdateConnectionList(draftId string) error {
	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "connectionList", cl)
	if err != nil {
		return err
	}
	return nil
}

func NewDraft(draftId string, manager *DraftManager) (*Draft, error) {
	return newDraft(draftId, manager, false)
}

// NewDraftForRecovery creates a draft instance even if the league is locked/filled.
// Used by RecoverActiveDrafts to resume mid-progress drafts after server restart.
func NewDraftForRecovery(draftId string, manager *DraftManager) (*Draft, error) {
	return newDraft(draftId, manager, true)
}

func newDraft(draftId string, manager *DraftManager, skipLockCheck bool) (*Draft, error) {

	var leagueDoc models.League
	err := utils.Db.ReadDocument("drafts", draftId, &leagueDoc)
	if err != nil {
		fmt.Println("Error reading drafts document: ", err)
		return nil, err
	}
	if !skipLockCheck && leagueDoc.IsLocked {
		errMes := fmt.Sprintf("%s is locked so you cannot join this league and we are returning", draftId)
		fmt.Println(errMes)
		return nil, fmt.Errorf(errMes)
	}
	currentPlayers := make(map[string]models.PlayerInfo)
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "playerState", &currentPlayers)
	if err != nil || currentPlayers == nil {
		fmt.Println("Error because all the players state is nil in default user picking: ", err)
		return nil, err
	}

	connectionList := &ConnectionList{
		List: make(map[string]bool),
	}
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "connectionList", &connectionList)
	if err != nil || connectionList == nil {
		fmt.Println("Connection list was empty or there was an error when creating a new connection in NewDraft()")
		return nil, err
	}

	info := models.DraftInfo{
		DraftOrder: make([]models.LeagueUser, 0),
	}
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "info", &info)
	if err != nil || info.DraftId == "" {
		return nil, err
	}

	// turn this function into a trigger on firebase whenever a draft league is filled so that we can just read this document from the database and then whenever we publish something to redis we will also update the database
	obj := &Draft{
		draftId:              strings.ToLower(draftId),
		StartTime:            info.DraftStartTime,
		userConnectionStatus: connectionList.List,
		activeUsers:          make(map[string]*Client),
		draftManager:         manager,
		RedisChannels: &RedisChannels{
			DraftChannelName: fmt.Sprintf("%s-channel", draftId),
		},
		RedisManager: make(MessageManager),
		DraftInfo:    &info,
		IsGM:         false,
		IsCommplete:  false,
		CurrentTimer: nil, // Start with no timer
	}

	fmt.Println("created draft object")
	// publish a connection message to the info channel and check how many people are subscribed
	// if nobody is subscribed then we are the first
	var r utils.RedisMessage
	r.Sender = obj.draftManager.Id
	r.EventType = utils.StatusSubChannel
	data, err := json.Marshal(connectionList.List)
	if err != nil {
		return nil, err
	}
	r.Payload = data
	mes, err := json.Marshal(&r)
	if err != nil {
		return nil, err
	}
	fmt.Println("publishing connection list message to the status redis channel for draft")
	res := utils.PubConn.Publish(context.Background(), obj.RedisChannels.DraftChannelName, mes)
	if err := res.Err(); err != nil {
		fmt.Println("Error publishing message to status channel in NewDraft: ", err)
		return nil, err
	}
	if res.Val() == 0 {
		fmt.Println("making this draft manager instance the gm")
		obj.IsGM = true
		// call function that will start the draft
		go WaitForStartOfDraft(obj.StartTime, obj.DraftInfo.PickLength, obj)
		fmt.Println("started go routine to wait for draft start time")
	}

	obj.RedisManager[utils.PickSubChannel] = obj.handlePickRedisMessage
	obj.RedisManager[utils.TimerSubChannel] = obj.handleTimerRedisMessage
	obj.RedisManager[utils.CompleteSubChannel] = obj.handleDraftCompleteRedisMessage
	obj.RedisManager[utils.CountdownSubChannel] = obj.handleCountdownRedisMessage
	obj.RedisManager[utils.StatusSubChannel] = obj.handleStatusRedisMessage
	obj.RedisManager[utils.InfoSubChannel] = obj.handleDraftInfoRedisMessage

	go obj.listenForRedisMessagesForDraft()

	fmt.Println("Returning draft object to http function")
	return obj, nil
}

func (d *Draft) getDraftChannelName() string {
	return d.RedisChannels.DraftChannelName
}

func (d *Draft) setDraftChannel(ch *redis.PubSub) {
	d.Lock()
	defer func() {
		d.Unlock()
	}()
	d.RedisChannels.DraftChannel = ch
	fmt.Println("set pick channel")
}

func (d *Draft) addUserToDraftRoom(client *Client, address string) {
	d.Lock()
	defer func() {
		d.Unlock()
	}()
	d.activeUsers[address] = client
	d.userConnectionStatus[address] = true
	cl := CreateConnectionList(d.userConnectionStatus)
	err := cl.UpdateConnectionList(d.draftId)
	if err != nil {
		fmt.Printf("Error in updating the connection list for draft: %s with error: %v\r", d.draftId, err)
	}

	var r utils.RedisMessage
	r.Sender = d.draftManager.Id
	r.EventType = utils.StatusSubChannel
	data, err := json.Marshal(&cl)
	if err != nil {
		fmt.Println("Error marshaling redis message and we are returning from addUserToDraftRoom: ", err)
		return
	}
	r.Payload = data

	res := utils.PubConn.Publish(context.Background(), d.RedisChannels.DraftChannelName, &r)
	if res.Err() != nil {
		fmt.Println("Error in publishing status connection update to redis: ", res.Err())
	}
	fmt.Printf("added %s to draft room: %s\r", address, d.draftId)

	// send a timer update to the person who joined
	if d.CurrentTimer != nil {
		t := &TimerUpdateMessage{
			CurrentDrafter:       d.CurrentTimer.currentDrafter,
			StartOfTurnTimestamp: d.CurrentTimer.StartOfTurnTimestamp,
			EndOfTurnTimestamp:   d.CurrentTimer.EndOfTurnTimestamp,
		}
		data, err := json.Marshal(t)
		if err != nil {
			fmt.Println("ERROR marshalling data for timer message so we are returning: ", err)
		}

		e := Event{
			Type:    TimerEvent,
			Payload: data,
		}

		// queue message to be sent
		client.egress <- e
	}

	// fetch their queue and send to the person who joined
	// queue, err := models.FetchQueueForDrafter(d.draftId, address)
	// if err != nil {
	// 	fmt.Println("Unable to send queue")
	// 	return
	// }
	// fmt.Println(queue)

	// data, err = json.Marshal(&queue)
	// if err != nil {
	// 	fmt.Println("error marshalling draft queue: ", err)
	// 	return
	// }

	// queueEvent := Event{
	// 	Type:    NewQueue,
	// 	Payload: data,
	// }

	// client.egress <- queueEvent
}

func (d *Draft) removeUserFromRoom(address string) {
	d.Lock()
	defer func() {
		d.Unlock()
	}()
	if _, ok := d.activeUsers[address]; !ok {
		fmt.Printf("This user was not found in the connection draft and should not be in this draft: %s with address: %s\r", d.draftId, address)
		return
	}

	delete(d.activeUsers, address)
	d.userConnectionStatus[address] = false

	cl := CreateConnectionList(d.userConnectionStatus)
	err := cl.UpdateConnectionList(d.draftId)
	if err != nil {
		fmt.Printf("Error in updating the connection list for draft: %s with error: %v\r", d.draftId, err)
	}

	var r utils.RedisMessage
	r.Sender = d.draftManager.Id
	r.EventType = utils.StatusSubChannel
	data, err := json.Marshal(&cl)
	if err != nil {
		fmt.Println("ERROR marshalling redis message: ", err)
		return
	}
	r.Payload = data

	res := utils.PubConn.Publish(context.Background(), d.RedisChannels.DraftChannelName, &r)
	if res.Err() != nil {
		fmt.Println("Error in publishing status connection update to redis: ", res.Err())
	}

	fmt.Println("Removed client from draft room")

}

func (d *Draft) ReturnDraftTokensToUser() error {
	fmt.Println("Inside of return draft tokens to user")
	data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/cards", d.draftId)).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error reading all cards inside of draft: ", err)
		return err
	}

	for i := 0; i < len(data); i++ {
		snap := data[i]
		var token models.DraftToken
		err = snap.DataTo(&token)
		if err != nil {
			fmt.Println("Unable to marshal snapshot into draft token: ", err)
			return err
		}
		if c, ok := d.activeUsers[token.OwnerId]; ok {
			fmt.Println("Found token in activeUsers to send to front end")
			res, err := json.Marshal(token)
			if err != nil {
				fmt.Println("error marshalling token to send to client: ", err)
				return err
			}
			var e Event
			e.Type = FinalCard
			e.Payload = res
			// Non-blocking send — a slow client used to stall this whole
			// broadcast loop and freeze final-card delivery for everyone.
			// If their egress is full, drop and let them resync on
			// reconnect rather than blocking the rest of the draft.
			select {
			case c.egress <- e:
			default:
				fmt.Printf("[ws] slow client %s — dropping FinalCard event\n", c.address)
			}
		} else {
			fmt.Println("This user was not connected to this server instance: ", d.draftManager.Id)
		}
	}

	fmt.Println("FInished returning draft tokens to users")
	return nil
}

func (d *Draft) CloseAndCleanUpDraftUponComplete() {
	fmt.Println("In the function to close the draft")
	if d.DraftInfo.CurrentPickNumber < 150 || d.DraftInfo.CurrentRound < 15 {
		fmt.Println("the draft is still going on")
		return
	}

	// Check and make sure summary has 150 picks. Pick 149 (the last) must be
	// FILLED for the draft to be considered complete. The previous condition
	// was inverted — `!= ""` returned early when the last pick WAS filled,
	// which is exactly when we should proceed to close. Drafts that should
	// have cleaned up never did. (BUG #18)
	var summary models.DraftSummary
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", d.draftId), "summary", &summary)
	if err != nil {
		fmt.Println("error reading summary in CloseAndCleanUpDraftUponComplete()")
		return
	}
	if summary.Summary[149].PlayerInfo.PlayerId == "" {
		fmt.Println("Final pick not yet recorded — refusing to close draft: ", d.DraftInfo)
		return
	}

	for {
		var league models.League
		err := utils.Db.ReadDocument("drafts", d.draftId, &league)
		if err != nil {
			fmt.Println("ERror reading drafts document in close and clean drafts: ", err)
		}
		if league.IsLocked {
			fmt.Println("league has been locked now")
			break
		} else {
			fmt.Println("WE are sleeping and waiting for league to be locked")
		}
		time.Sleep(2 * time.Second)
	}

	time.Sleep(2 * time.Second)
	err = d.ReturnDraftTokensToUser()
	if err != nil {
		fmt.Println("ERROR sending the updated draft tokens back to the user: ", err)
	}

	fmt.Println("sleeping for 20 seconds before deleting and cleaning up draft")
	time.Sleep(10 * time.Second)

	fmt.Println("closing all redis channels for this draft")
	ctx := context.Background()
	d.RedisChannels.DraftChannel.Unsubscribe(ctx, d.RedisChannels.DraftChannelName)
	err = d.RedisChannels.DraftChannel.Close()
	if err != nil {
		fmt.Println("Error closing Draft channel", err)
	}
	fmt.Println("successfully closed all redis channels")

	for _, c := range d.activeUsers {
		fmt.Println("removing ", c.address)
		d.draftManager.removeClient(c)
	}
	fmt.Printf("Removed all clients connected to %s because draft is complete\r", d.draftManager.Id)

	d.draftManager.RemoveDraftInstanceFromMap(d.draftId)

}

func (d *Draft) broadcastEventToActiveUsers(data Event) {
	fmt.Printf("Broadcasting event from %s to %d connected clients: %v\r", d.draftManager.Id, len(d.activeUsers), data)
	for _, client := range d.activeUsers {
		// Non-blocking — one slow client used to stall the entire
		// broadcast loop and freeze pick / timer events for everyone in
		// the draft. (BUG #23) Drop the event for the laggy client and
		// let them resync on reconnect or via the next broadcast.
		select {
		case client.egress <- data:
		default:
			fmt.Printf("[ws] slow client %s — dropping broadcast event\n", client.address)
		}
	}
}

func (d *Draft) handlePickRedisMessage(redisMessage utils.RedisMessage) {
	NewPickEvent := Event{
		Type:    EventSendPick,
		Payload: redisMessage.Payload,
	}
	d.broadcastEventToActiveUsers(NewPickEvent)
	fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"redis_pick_received"}`+"\n", d.draftId)
	if !d.IsCommplete {
		if redisMessage.Sender == d.draftManager.Id {
			fmt.Println("Starting the next timer for new pick with drafter: ", d.DraftInfo.CurrentDrafter)
			fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"redis_starting_next_timer","nextDrafter":"%s"}`+"\n", d.draftId, d.DraftInfo.CurrentDrafter)
			time.Sleep(250 * time.Millisecond)
			go StartDraftTimerForCurrentPick(d.DraftInfo.CurrentDrafter, d.DraftInfo.PickLength, d)
		} else {
			fmt.Println("This message was not sent by this manager")
		}
	} else {
		fmt.Println("the draft is complete so we are not starting a new timer")
		fmt.Printf(`{"severity":"INFO","draftId":"%s","event":"redis_draft_complete"}`+"\n", d.draftId)
	}

	fmt.Println("Handled Pick Redis Message in ", d.draftId)
}

func (d *Draft) handleDraftInfoRedisMessage(mes utils.RedisMessage) {
	var info models.DraftInfo
	if err := json.Unmarshal(mes.Payload, &info); err != nil {
		fmt.Println("ERROR in unmarshalling data from redis message into models.DraftInfo in handleDraftInfoRedisMessage: ", err)
		return
	}

	if mes.Sender != d.draftManager.Id {
		d.DraftInfo.Lock()
		d.DraftInfo.CurrentDrafter = info.CurrentDrafter
		d.DraftInfo.CurrentPickNumber = info.CurrentPickNumber
		d.DraftInfo.PickInRound = info.PickInRound
		d.DraftInfo.CurrentRound = info.CurrentRound
		d.DraftInfo.Unlock()
	}

	e := Event{
		Type:    DraftInfoUpdateMessage,
		Payload: mes.Payload,
	}
	d.broadcastEventToActiveUsers(e)
	fmt.Println("Handled Draft info redis message in ", d.draftId)
}

func (d *Draft) handleTimerRedisMessage(mes utils.RedisMessage) {
	e := Event{
		Type:    TimerEvent,
		Payload: mes.Payload,
	}
	d.broadcastEventToActiveUsers(e)
	fmt.Println("Handled timer redis message for ", d.draftId)
}

func (d *Draft) handleStatusRedisMessage(mes utils.RedisMessage) {
	if mes.Sender == d.draftManager.Id {
		return
	}

	newList := &ConnectionList{
		List: make(map[string]bool),
	}
	if err := json.Unmarshal(mes.Payload, newList); err != nil {
		fmt.Printf("Error unmarshalling data to ConnectionList in handleStatusRedisMessage for channel %s with error: %v", d.RedisChannels.DraftChannelName, err)
		return
	}
	d.Lock()
	defer d.Unlock()
	d.userConnectionStatus = newList.List
	fmt.Println("Handled status redis message in ", d.draftId)
}

type SendDraftComplete struct {
	HasCompletedClosing bool `json:"hasCompletedClosing"`
}

func (d *Draft) handleDraftCompleteRedisMessage(mes utils.RedisMessage) {
	var comp SendDraftComplete
	if err := json.Unmarshal(mes.Payload, &comp); err != nil {
		fmt.Println("Error unmarshalling redisMessage into SendDraftComplete: ", err)
		return
	}

	e := Event{
		Type:    DraftCompleteMessage,
		Payload: mes.Payload,
	}
	d.broadcastEventToActiveUsers(e)

	if comp.HasCompletedClosing {
		fmt.Println("starting go routine that will clean up and delete this draft object in 5 minutes")
		fmt.Println("Inside of HasCompletedClosing: ", comp)
		d.CloseAndCleanUpDraftUponComplete()
	}
	fmt.Println("Handled Draft Complete Message from redis Message in ", d.draftId)
}

func (d *Draft) handleCountdownRedisMessage(mes utils.RedisMessage) {
	e := Event{
		Type:    CountdownEvent,
		Payload: mes.Payload,
	}
	d.broadcastEventToActiveUsers(e)
}

func (d *Draft) GoToNextPickInDraftInfo() error {
	err := d.DraftInfo.UpdateDraftInfoFromNewPick(d.getDraftChannelName(), d.draftManager.Id)
	if err != nil {
		fmt.Println("error updating draft info: ", err)
		return err
	}
	return nil
}

func (d *Draft) listenForRedisMessagesForDraft() {
	ctx := context.Background()
	pubsub := utils.SubConn.Subscribe(ctx, d.RedisChannels.DraftChannelName)
	_, err := pubsub.Receive(ctx)
	if err != nil {
		fmt.Printf("Errored out trying to receive on new pubsub for %s: %v\r", d.draftId, err)
		return
	}

	d.setDraftChannel(pubsub)
	ch := pubsub.Channel()
	defer func() {
		pubsub.Unsubscribe(ctx, d.RedisChannels.DraftChannelName)
		pubsub.Close()
		fmt.Println("Pubsub connection cleaned up in defer function of listenForRedisMessagesForDraft for ", d.draftId)
	}()

	for message := range ch {
		var mes utils.RedisMessage
		if err := json.Unmarshal([]byte(message.Payload), &mes); err != nil {
			fmt.Println("Error unmarshaling message from redis into utils.RedisMessage: ", err)
			continue
		}

		if helperFunction, ok := d.RedisManager[mes.EventType]; ok {
			go helperFunction(mes)
		}
	}
}
