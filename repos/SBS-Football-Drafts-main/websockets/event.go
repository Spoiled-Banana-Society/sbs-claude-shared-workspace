package websockets

import (
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/models"
)

type Event struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type EventHandler func(event Event, c *Client) error

const (
	// event name for receiving new picks
	EventReceivePick = "pick_received"

	// event name for queue updates
	EventReceiveQueueUpdate = "queue_update"

	// event name for sending a new pick to clients
	EventSendPick = "new_pick"

	// event name for receiving a chat message
	EventSendMessage = "send_message"

	// event name for sending the response read from send_message
	EventNewMessage = "new_message"

	TimerEvent = "timer_update"

	DraftInfoUpdateMessage = "draft_info_update"

	DraftCompleteMessage = "draft_complete"

	CountdownEvent = "countdown_update"

	InvalidPick = "invalid_pick"

	FinalCard = "final_card"

	// event name for queue updates
	NewQueue = "new_queue"
)

type SendPickMessage struct {
	// New Pick info
	NewPick models.PlayerInfo `json:"newPick"`
	// address of the next drafter
	NextDrafter string `json:"nextDrafter"`
	// current pick number
	CurrentPickNum int `json:"currentPick"`
}

func HandleNewPickMessage(event Event, c *Client) error {
	// Atomic compare-and-set: claim the pick slot or fail fast. Replaces a
	// busy-wait + non-atomic bool that could (a) race the read/write across
	// goroutines and (b) let two picks both observe currentlyPicking=false
	// and proceed concurrently — a real "two picks in one slot" risk under
	// load. (BUG #24)
	if !atomic.CompareAndSwapInt32(&c.currentlyPicking, 0, 1) {
		return fmt.Errorf("pick already in flight for %s — rejecting concurrent pick", c.address)
	}
	defer atomic.StoreInt32(&c.currentlyPicking, 0)
	var newPick models.PlayerInfo
	err := json.Unmarshal(event.Payload, &newPick)
	if err != nil {
		return fmt.Errorf("unable to unmarshal event payload into NewPick type: %v with err: %v", event.Payload, err)
	}

	// don't accept late picks
	now := time.Now().Unix()
	if now > c.draftRoom.CurrentTimer.EndOfTurnTimestamp+1 {
		fmt.Printf("This pick is not being accepted because it came in at %d for a pick with an end timestamp of %d\r", now, c.draftRoom.CurrentTimer.EndOfTurnTimestamp)
		fmt.Printf("pick owner: %s, Current Timer object: %v", newPick.OwnerAddress, c.draftRoom.CurrentTimer)
		fmt.Printf(`{"severity":"WARNING","draftId":"%s","pick":%d,"event":"manual_pick_rejected_late","drafter":"%s"}`+"\n", c.draftRoom.draftId, newPick.PickNum, newPick.OwnerAddress)
		return fmt.Errorf("unable to make pick as it shows it came in after the end timestamp")
	}

	if newPick.PlayerId == "" {
		fmt.Printf("The player passed in seems to be empty: %v\r", newPick)
		c.AlertUserOfInvalidDraftPick("The player passed in seems to be empty")
		return fmt.Errorf("received an empty new pick object")
	}

	if newPick.OwnerAddress != c.address {
		fmt.Printf("new pick: %v, client address: %s\r", newPick, c.address)
		fmt.Println("we received a pick from an address that either does not match up with the owner of the new pick")
		fmt.Printf(`{"severity":"WARNING","draftId":"%s","event":"manual_pick_rejected_wrong_address","drafter":"%s"}`+"\n", c.draftRoom.draftId, newPick.OwnerAddress)
		c.AlertUserOfInvalidDraftPick("received a pick from an address that either does not match up with the owner of the new pick")
		return fmt.Errorf("recieved a pick from an unexpected user")
	}

	if newPick.OwnerAddress != c.draftRoom.DraftInfo.CurrentDrafter {
		fmt.Printf("new pick: %v, current draft: %s\r", newPick, c.draftRoom.DraftInfo.CurrentDrafter)
		fmt.Println("we received a pick from an address that it is not currently their turn so we are returning")
		fmt.Printf(`{"severity":"WARNING","draftId":"%s","event":"manual_pick_rejected_wrong_turn","drafter":"%s","currentDrafter":"%s"}`+"\n", c.draftRoom.draftId, newPick.OwnerAddress, c.draftRoom.DraftInfo.CurrentDrafter)
		c.AlertUserOfInvalidDraftPick("we received a pick from an address that it is not currently their turn so we are returning")
		return fmt.Errorf("recieved a pick from an unexpected user::::  new pick owner: %s, current drafter: %s, pick object: %v", newPick.OwnerAddress, c.draftRoom.DraftInfo.CurrentDrafter, newPick)
	}

	if newPick.Round != c.draftRoom.DraftInfo.CurrentRound {
		fmt.Println("ERROR received a pick with the wrong round number")
		c.AlertUserOfInvalidDraftPick("we received a pick with the wrong round so we are returning")
		return fmt.Errorf("we received a pick with the wrong round so we are returning")
	}

	fmt.Println("Received a pick from client: ", newPick)
	fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"manual_pick_received","drafter":"%s","player":"%s"}`+"\n", c.draftRoom.draftId, newPick.PickNum, newPick.OwnerAddress, newPick.PlayerId)

	if err := newPick.MakePickFromPlayerInfo(c.draftRoom.draftId, c.address, c.draftRoom.getDraftChannelName(), c.draftRoom.draftManager.Id); err != nil {
		fmt.Println("ERROR we were unable to make the pick. Returning so draft can continue")
		fmt.Printf(`{"severity":"ERROR","draftId":"%s","pick":%d,"event":"manual_pick_failed","player":"%s"}`+"\n", c.draftRoom.draftId, newPick.PickNum, newPick.PlayerId)
		c.AlertUserOfInvalidDraftPick(fmt.Sprintf("Error picking player: %v", err))
		return fmt.Errorf("ERROR making the user pick. Returning so draft can continue.")
	}

	// err = models.CheckIfPlayerIsPickedAlready(c.draftRoom.draftId, newPick.PlayerId)
	// if err != nil {
	// 	c.AlertUserOfInvalidDraftPick("Player picked seems to be already picked in player State")
	// 	return err
	// }

	// // update database with new pick
	// err = newPick.UpdatePlayerInDraft(c.draftName)
	// if err != nil {
	// 	c.AlertUserOfInvalidDraftPick(err.Error())
	// 	return err
	// }
	// fmt.Println("updated player state from a pick recieved on the client")

	// err = newPick.UpdateDraftSummary(c.draftName)
	// if err != nil {
	// 	fmt.Println("error updating draft summary: ", err)
	// 	c.AlertUserOfInvalidDraftPick(err.Error())
	// 	models.RevertPlayerUpdateInDraft(c.draftRoom.draftId, newPick)
	// 	return err
	// }
	// fmt.Println("updated draft summary from a pick recieved on the client")

	// err = models.UpdateRosterFromPick(c.draftName, c.address, newPick.Team, newPick.Position, newPick.PlayerId, newPick.DisplayName)
	// if err != nil {
	// 	fmt.Println("Error updating the roster from the pick event that was received")
	// 	return err
	// }
	// fmt.Println("updated rosters from a pick recieved on the client")

	// var m utils.RedisMessage
	// m.Sender = c.manager.Id
	// m.EventType = utils.PickSubChannel
	// m.Payload = []byte(event.Payload)

	// data, err := json.Marshal(&m)
	// if err != nil {
	// 	return err
	// }

	// // publish NewPickMessage to redis channel
	// res := utils.PubConn.Publish(context.Background(), c.draftRoom.getDraftChannelName(), data)
	// if res.Err() != nil {
	// 	return res.Err()
	// }
	// fmt.Println("published new pick received by client to redis")

	if c.draftRoom.DraftInfo.CurrentPickNumber == 150 {
		fmt.Printf("We just received pick 150 from client: %v\r", newPick)
		c.draftRoom.IsCommplete = true
	} else {
		if c.draftRoom.DraftInfo.CurrentPickNumber != newPick.PickNum {
			fmt.Println("We are NOT going to advance the drafter because it has already advanced.")
			return nil
		}
	}

	err = c.draftRoom.GoToNextPickInDraftInfo()
	if err != nil {
		fmt.Println("Unable to advance drafter -- BAD")
		return err
	}
	fmt.Println("went to next draft pick from a pick recieved on the client")
	fmt.Printf(`{"severity":"INFO","draftId":"%s","pick":%d,"event":"manual_pick_advanced"}`+"\n", c.draftRoom.draftId, c.draftRoom.DraftInfo.CurrentPickNumber)

	return nil
}

func HandleQueueMessage(event Event, c *Client) error {
	fmt.Println("In queue event handler")
	var newQueue models.DraftQueue
	err := json.Unmarshal(event.Payload, &newQueue)
	if err != nil {
		fmt.Println("unable to unmarshal queue")
		return err
	}

	fmt.Println("updating queue on firestore")
	err = models.UpdateQueueForDraft(c.draftRoom.draftId, c.address, newQueue)
	if err != nil {
		fmt.Println("unable to update queue")
		return err
	}

	fmt.Println("are we able to get new queue?")
	res, err := json.Marshal(newQueue)
	if err != nil {
		fmt.Println("error marshalling token to send to client: ", err)
		return err
	}

	fmt.Println("sending response")
	fmt.Println(res)
	e := Event{
		Type:    NewQueue,
		Payload: res,
	}

	// send queue back to front end so that it can update the UI
	c.egress <- e

	return nil
}
