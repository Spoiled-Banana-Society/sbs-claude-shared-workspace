package websockets

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type ClientList map[*Client]bool

type ClientInfo struct {
	Address   string `json:"address"`
	DraftName string `json:"draftName"`
}

type Client struct {
	// websocket connection
	connection *websocket.Conn

	// client manager
	manager *DraftManager
	//egress unbufferred channel to avoid concurrent writes to front end client
	egress chan Event
	// user address
	address string
	// draft league Name
	draftName string

	// pointer to draft room
	draftRoom *Draft

	connClosedChan chan bool

	isAlive bool

	// currentlyPicking is an atomic flag (0/1). Set via CompareAndSwapInt32
	// in HandleNewPickMessage so a second pick attempt from the same client
	// can never sneak past the check while the first one is mid-flight.
	// Replaces the previous non-atomic bool + busy-wait sleep loop, which
	// had a real data race (read/write across goroutines without sync) and
	// could in theory let two picks land in the same slot. (BUG #24)
	currentlyPicking int32

	sync.Mutex
}

var (
	pongWait = 30 * time.Second

	pingInterval = (pongWait * 2) / 10
)

func NewClient(conn *websocket.Conn, manager *DraftManager, clientInfo ClientInfo) (*Client, error) {
	var client Client
	client.address = strings.ToLower(clientInfo.Address)
	client.connection = conn
	client.draftName = strings.ToLower(clientInfo.DraftName)
	client.manager = manager
	client.egress = make(chan Event, 50)
	client.isAlive = true
	draft, err := manager.getOrCreateDraftInstance(clientInfo)
	if err != nil {
		fmt.Println(err)
		return nil, err
	}
	client.setDraftRoom(draft)
	draft.addUserToDraftRoom(&client, client.address)
	fmt.Println("added client to draft: ", client.address)
	return &client, nil
}

func (c *Client) setDraftRoom(room *Draft) {
	c.Lock()
	defer c.Unlock()
	c.draftRoom = room
}

func (c *Client) readMessages() {
	defer func() {
		fmt.Println("In defer statement of readMessages and will be closing this clients connection")
		if !c.isAlive {
			return
		}
		c.Lock()
		c.isAlive = false
		c.Unlock()
		fmt.Println("calling removeClient from readMessages for ", c.address)
		c.manager.removeClient(c)
	}()

	c.connection.SetReadLimit(512)

	if err := c.connection.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		fmt.Println(err)
		return
	}

	c.connection.SetPongHandler(c.pongHandler)

	fmt.Println("Starting to listen for messages from the clients")
	for {
		mesageType, payload, err := c.connection.ReadMessage()
		fmt.Println("read Message Payload: ", payload)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err) {
				fmt.Printf("Error reading message: %v, with message type: %d\r", err, mesageType)
			}
			return
		}

		var request Event
		if err := json.Unmarshal(payload, &request); err != nil {
			fmt.Printf("Error marshalling message into event: %v\r", err)
			return
		}

		// route event to manager event handlers
		if err := c.manager.routeEvent(request, c); err != nil {
			fmt.Printf("Error routing event for request: %v\r", request)
			continue
		}
	}

}

func (c *Client) pongHandler(pongMsg string) error {
	//fmt.Println("got pong from client: ", c.address)
	return c.connection.SetReadDeadline(time.Now().Add(pongWait))
}

func (c *Client) writeMessages() {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		fmt.Println("in defer func for writeMessages")
		if !c.isAlive {
			return
		}
		c.Lock()
		c.isAlive = false
		c.Unlock()
		ticker.Stop()
		fmt.Println("calling remove client from defer func in writeMessages for ", c.address)
		c.manager.removeClient(c)
	}()

	fmt.Println("Starting to listen for messages on our event channel")
	for {
		select {
		case message, ok := <-c.egress:
			if !ok {
				fmt.Println("unable to read in event in channel and sent a close message")
				if err := c.connection.WriteMessage(websocket.CloseMessage, nil); err != nil {
					fmt.Println("Connection closed: ", err)
				}

				return
			}

			//fmt.Printf("Event read in from client egress channel to be sent to client: %v\r", message)

			data, err := json.Marshal(message)
			if err != nil {
				fmt.Println(err)
				return
			}

			if err := c.connection.WriteMessage(websocket.TextMessage, data); err != nil {
				fmt.Println("Error writing messaging to client: ", err)
				return
			}

			//fmt.Println("sent event to client: ", c.address)
		case <-ticker.C:
			if err := c.connection.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				fmt.Println("error when sending a ping message: ", err)
				return
			}
			//fmt.Println("Pinged the client at ", c.address)
		}
	}
}

type InvalidPickEvent struct {
	ErrorMessage string `json:"errorMessage"`
}

func (c *Client) AlertUserOfInvalidDraftPick(errMess string) error {
	obj := &InvalidPickEvent{
		ErrorMessage: errMess,
	}

	data, err := json.Marshal(obj)
	if err != nil {
		fmt.Println("ERror marshalling invalid pick event: ", err)
		return err
	}

	e := Event{
		Type:    InvalidPick,
		Payload: data,
	}

	c.egress <- e
	return nil
}
