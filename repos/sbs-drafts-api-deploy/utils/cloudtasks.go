package utils

import (
	"context"
	"fmt"
	"os"
	"time"

	cloudtasks "cloud.google.com/go/cloudtasks/apiv2"
	"cloud.google.com/go/cloudtasks/apiv2/cloudtaskspb"
	"google.golang.org/api/option"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var cloudTasksClient *cloudtasks.Client

// InitCloudTasksClient initializes the Cloud Tasks client
// Should be called during application startup
// In production (Cloud Run), uses Application Default Credentials (the service account
// running the app) so the Cloud Run SA's IAM roles apply. Locally uses Firebase creds.
func InitCloudTasksClient(isRunningLocal bool) error {
	ctx := context.Background()

	var client *cloudtasks.Client
	var err error

	if isRunningLocal {
		creds, credErr := getFirebaseCreds(true)
		if credErr != nil {
			return fmt.Errorf("failed to get credentials: %w", credErr)
		}
		client, err = cloudtasks.NewClient(ctx, option.WithCredentialsJSON(creds))
	} else {
		// Production: use ADC (Cloud Run service account) so cloudtasks.enqueuer on that SA is used
		client, err = cloudtasks.NewClient(ctx)
	}

	if err != nil {
		return fmt.Errorf("failed to create cloud tasks client: %w", err)
	}

	cloudTasksClient = client
	return nil
}

// GetenvOrDefault returns the value of the environment variable if it exists,
// otherwise returns the default value
func GetenvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// CreateCloudTask creates a Cloud Task that will be executed at the specified schedule time
// url: The full URL where the task will be sent (HTTP POST)
// payload: The JSON payload to send with the task
// scheduleTime: Unix timestamp when the task should be executed
func CreateCloudTask(url, payload string, scheduleTime int64) error {
	if cloudTasksClient == nil {
		return fmt.Errorf("cloud tasks client not initialized - call InitCloudTasksClient first")
	}

	ctx := context.Background()

	// Get project ID and location from environment variables
	projectID := GetenvOrDefault("GCP_PROJECT_ID", "")
	location := GetenvOrDefault("GCP_LOCATION", "us-central1")
	queueName := GetenvOrDefault("CLOUD_TASKS_QUEUE_NAME", "auto-draft-queue")

	if projectID == "" {
		return fmt.Errorf("GCP_PROJECT_ID environment variable is required")
	}

	// Construct the fully qualified queue name
	queuePath := fmt.Sprintf("projects/%s/locations/%s/queues/%s", projectID, location, queueName)

	// Convert schedule time to protobuf timestamp
	scheduleTimestamp := time.Unix(scheduleTime, 0)
	if scheduleTimestamp.Before(time.Now()) {
		// If the time is in the past, schedule for 1 second from now
		scheduleTimestamp = time.Now().Add(1 * time.Second)
	}

	// Create the task request
	req := &cloudtaskspb.CreateTaskRequest{
		Parent: queuePath,
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        url,
					Headers: map[string]string{
						"Content-Type": "application/json",
					},
					Body: []byte(payload),
				},
			},
			ScheduleTime: timestamppb.New(scheduleTimestamp),
		},
	}

	// Create the task
	_, err := cloudTasksClient.CreateTask(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to create cloud task: %w", err)
	}

	return nil
}

// CloseCloudTasksClient closes the Cloud Tasks client
// Should be called during application shutdown
func CloseCloudTasksClient() error {
	if cloudTasksClient != nil {
		return cloudTasksClient.Close()
	}
	return nil
}
