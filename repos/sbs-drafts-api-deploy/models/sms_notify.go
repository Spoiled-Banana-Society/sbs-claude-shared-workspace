package models

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/notifications/onesignal"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// claimDraftStartSmsOnce creates a Firestore subdocument exactly once per draft.
// Returns true if this invocation should send; false if a previous run already claimed.
func claimDraftStartSmsOnce(draftID string) bool {
	ctx := context.Background()
	ref := utils.Db.Client.Collection("drafts").Doc(draftID).Collection("smsNotificationClaims").Doc("draftStart")
	_, err := ref.Create(ctx, map[string]interface{}{
		"claimedAtUnix": time.Now().Unix(),
	})
	if err == nil {
		return true
	}
	if status.Code(err) == codes.AlreadyExists {
		return false
	}
	fmt.Printf("claimDraftStartSmsOnce: draftId=%s err=%v — proceeding with send\n", draftID, err)
	return true
}

// NotifyDraftStartingSMS notifies league members that the draft room is full and
// the draft is starting. Non-blocking callers should wrap in a goroutine.
func NotifyDraftStartingSMS(draftID, displayName string, ownerIDs []string) {
	client := onesignal.Default()
	if !client.Enabled() {
		return
	}
	// Claim only when we intend to send, so disabling OneSignal does not burn the idempotency key.
	if !claimDraftStartSmsOnce(draftID) {
		return
	}

	eligible := make([]string, 0, len(ownerIDs))
	for _, raw := range ownerIDs {
		id := strings.ToLower(strings.TrimSpace(raw))
		if id == "" {
			continue
		}
		owner, err := ReturnOwnerObjectById(id)
		if err != nil {
			fmt.Printf("NotifyDraftStartingSMS: owner %s read err=%v\n", id, err)
			continue
		}
		if !OwnerEligibleForSmsDraftStart(owner) {
			continue
		}
		eligible = append(eligible, id)
	}
	if len(eligible) == 0 {
		return
	}

	msg := fmt.Sprintf("Your SBS draft \"%s\" is starting now. Open the app to pick.", displayName)
	if err := client.SendSMS(context.Background(), eligible, msg); err != nil {
		fmt.Printf("NotifyDraftStartingSMS: draftId=%s onesignal err=%v\n", draftID, err)
	}
}

// NotifyPickReminderSMS notifies the user now on the clock that it is their turn.
func NotifyPickReminderSMS(draftID, displayName, ownerID string) {
	client := onesignal.Default()
	if !client.Enabled() {
		return
	}

	id := strings.ToLower(strings.TrimSpace(ownerID))
	if id == "" {
		return
	}

	owner, err := ReturnOwnerObjectById(id)
	if err != nil {
		fmt.Printf("NotifyPickReminderSMS: owner %s read err=%v\n", id, err)
		return
	}
	if !OwnerEligibleForSmsPickReminder(owner) {
		return
	}

	msg := fmt.Sprintf("You're on the clock in \"%s\". Open the SBS app to make your pick.", displayName)
	if err := client.SendSMS(context.Background(), []string{id}, msg); err != nil {
		fmt.Printf("NotifyPickReminderSMS: draftId=%s owner=%s onesignal err=%v\n", draftID, id, err)
	}
}
