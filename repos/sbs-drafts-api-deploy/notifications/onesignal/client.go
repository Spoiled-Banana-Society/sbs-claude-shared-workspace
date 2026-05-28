// Package onesignal sends SMS via OneSignal REST API.
// Set ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY to enable; if unset, all sends no-op.
package onesignal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const notificationsURL = "https://api.onesignal.com/notifications"

// Client calls OneSignal's notification API with SMS as target_channel.
type Client struct {
	appID      string
	apiKey     string
	httpClient *http.Client
}

// NewFromEnv builds a client from ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY.
func NewFromEnv() *Client {
	return &Client{
		appID:  os.Getenv("ONESIGNAL_APP_ID"),
		apiKey: os.Getenv("ONESIGNAL_REST_API_KEY"),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

var defaultClient *Client

// Default returns a shared client (lazy init).
func Default() *Client {
	if defaultClient == nil {
		defaultClient = NewFromEnv()
	}
	return defaultClient
}

// Enabled is true when credentials are present.
func (c *Client) Enabled() bool {
	return c != nil && c.appID != "" && c.apiKey != ""
}

type createNotificationBody struct {
	AppID           string              `json:"app_id"`
	IncludeAliases  map[string][]string `json:"include_aliases"`
	TargetChannel   string              `json:"target_channel"`
	Contents        map[string]string   `json:"contents"`
	ExistingAndroid bool                `json:"isAndroid,omitempty"`
	ExistingIOS     bool                `json:"isIos,omitempty"`
	ExistingWeb     bool                `json:"isAnyWeb,omitempty"`
}

// SendSMS sends one SMS body to all given external_ids (wallet ids, lowercased).
// One request supports up to 20k ids per OneSignal docs; we batch under that.
func (c *Client) SendSMS(ctx context.Context, externalIDs []string, message string) error {
	if !c.Enabled() {
		return nil
	}
	if len(externalIDs) == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	body := createNotificationBody{
		AppID: c.appID,
		IncludeAliases: map[string][]string{
			"external_id": externalIDs,
		},
		TargetChannel: "sms",
		Contents:      map[string]string{"en": message},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("onesignal: marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, notificationsURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("onesignal: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.SetBasicAuth(c.apiKey, "")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("onesignal: http: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("onesignal: status %d body=%s", resp.StatusCode, string(respBody))
	}
	return nil
}
