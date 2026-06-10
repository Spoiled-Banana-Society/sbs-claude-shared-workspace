package utils

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	secretmanager "cloud.google.com/go/secretmanager/apiv1"
	secretmanagerpb "cloud.google.com/go/secretmanager/apiv1/secretmanagerpb"
	firebase "firebase.google.com/go"
	"firebase.google.com/go/db"
	"google.golang.org/api/option"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type DatabaseConn struct {
	Client *firestore.Client
	RTdb   *db.Client
}

var Db *DatabaseConn

type any = interface{}

func GetDraftTokenCollectionName() string {
	return "draftTokens"
}

func GetDraftTokenMetadataCollectionName() string {
	return "draftTokenMetadata"
}

//var client *db.Client

func NewDatabaseClient(isRunningLocal bool) {
	ctx := context.Background()
	creds, err := getFirebaseCreds(isRunningLocal)
	if err != nil {
		fmt.Println(err)
		panic(err)
	}
	conf := option.WithCredentialsJSON(creds)
	app, err := firebase.NewApp(ctx, nil, conf)
	if err != nil {

		panic(err)
	}

	client, err := app.Firestore(ctx)
	if err != nil {
		panic(err)
	}

	env := os.Getenv("ENVIRONMENT")
	var realTimeDbUrl string
	if isRunningLocal {
		realTimeDbUrl = "https://sbs-test-env-default-rtdb.firebaseio.com"
	} else {
		if env == "prod" {
			realTimeDbUrl = os.Getenv("PROD_RT_DB_URL")
		} else {
			realTimeDbUrl = os.Getenv("TEST_RT_DB_URL")
		}
	}

	realTimeConfig := &firebase.Config{
		DatabaseURL: realTimeDbUrl,
	}

	rtApp, err := firebase.NewApp(ctx, realTimeConfig, conf)
	if err != nil {
		panic(err)
	}

	realTime, err := rtApp.Database(ctx)
	if err != nil {
		panic(err)
	}

	Db = &DatabaseConn{client, realTime}
}

func getFirebaseCreds(isRunningLocal bool) ([]byte, error) {
	// path to secret projects/991530757352/secrets/sbs-triggers-service-config/versions/1

	if isRunningLocal {
		// jsonFile, err := os.Open("../configs/sbs-test-env-config.json")
		jsonFile, err := os.Open("../configs/sbs-prod-env-firebase.json")
		// if we os.Open returns an error then handle it
		if err != nil {
			fmt.Println(err)
		}
		fmt.Println("Successfully Opened users.json")
		// defer the closing of our jsonFile so that we can parse it later on
		defer jsonFile.Close()

		creds, err := io.ReadAll(jsonFile)
		if err != nil {
			return nil, err
		}
		return creds, nil
	} else {
		ctx := context.Background()
		client, err := secretmanager.NewClient(ctx)
		if err != nil {
			panic(err)
		}
		defer client.Close()

		env := os.Getenv("ENVIRONMENT")
		var credsLocation string
		if env == "prod" {
			credsLocation = os.Getenv("PROD_GCP_CREDS_LOCATION")
		} else {
			credsLocation = os.Getenv("TEST_GCP_CREDS_LOCATION")
		}

		// use when deploying to prod
		req := &secretmanagerpb.AccessSecretVersionRequest{
			Name: credsLocation,
		}

		res, err := client.AccessSecretVersion(ctx, req)
		if err != nil {
			panic(err)
		}
		return res.GetPayload().Data, nil
	}

}

// slowOpThreshold: Firestore ops slower than this get a structured WARNING
// line (path + duration + payload size). Failures always log as ERROR with
// the same fields. Pure observability — added 2026-06-10 after a transient
// 60s DeadlineExceeded on a playerState write mid-pick froze draft
// 2024-fast-draft-1381 and the engine only logged THAT it failed, not which
// doc / how long / how big. Grep: firestore_slow_op / firestore_op_failed.
const slowOpThreshold = 2 * time.Second

// Per-attempt timeout + retry ceiling for wrapper-routed Firestore ops.
// THE FREEZE FIX (2026-06-10, draft 2024-fast-draft-1381): a single write
// stalled for the gRPC default 60s, died with DeadlineExceeded, and nothing
// ever retried it — freezing the draft mid-pick. Now: each attempt is capped
// at 2s (above healthy-write p99, far below the 30s pick clock) and a failed
// attempt is re-sent IMMEDIATELY with the IDENTICAL payload — idempotent by
// construction (same bytes, same place; a zombie first attempt landing late
// converges to the same state). Worst realistic case: pick lands ~2.1s late.
// 3 attempts is a ceiling, not a count — the happy path is exactly 1 attempt.
const (
	dbAttemptTimeout = 2 * time.Second
	dbMaxAttempts    = 3
)

// IsTransientDbErr: failures worth retrying (momentary stall / backend blip).
// Validation-class errors (NotFound, InvalidArgument, PermissionDenied,
// AlreadyExists…) are NOT retried — they'd fail identically every time.
func IsTransientDbErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	if s, ok := status.FromError(err); ok {
		switch s.Code() {
		case codes.DeadlineExceeded, codes.Unavailable, codes.Aborted, codes.Internal, codes.ResourceExhausted:
			return true
		}
	}
	return false
}

func logDbOp(op, collection, documentId string, attempt int, start time.Time, opErr error, v any) {
	d := time.Since(start)
	if opErr == nil && d < slowOpThreshold && attempt == 1 {
		return
	}
	sizeBytes := -1
	if v != nil {
		if data, mErr := json.Marshal(v); mErr == nil {
			sizeBytes = len(data)
		}
	}
	severity := "WARNING"
	event := "firestore_slow_op"
	errStr := ""
	if opErr != nil {
		severity = "ERROR"
		event = "firestore_op_failed"
		errStr = opErr.Error()
	} else if attempt > 1 {
		// A retry SUCCEEDED — the fix did its job; log it as the win it is.
		event = "firestore_retry_succeeded"
	}
	fmt.Printf(`{"severity":"%s","event":"%s","op":"%s","path":"%s/%s","attempt":%d,"ms":%d,"sizeBytes":%d,"error":%q}`+"\n",
		severity, event, op, collection, documentId, attempt, d.Milliseconds(), sizeBytes, errStr)
}

// withRetry: run one Firestore op with the per-attempt timeout, re-sending
// the identical op on transient failure. Every attempt is logged with its
// attempt number, duration and payload size.
func withRetry(op, collection, documentId string, v any, fn func(ctx context.Context) error) error {
	var err error
	for attempt := 1; attempt <= dbMaxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), dbAttemptTimeout)
		start := time.Now()
		err = fn(ctx)
		cancel()
		logDbOp(op, collection, documentId, attempt, start, err, v)
		if err == nil || !IsTransientDbErr(err) {
			return err
		}
	}
	return err
}

func (db *DatabaseConn) ReadDocument(collection string, documentId string, v any) error {
	var snapshot *firestore.DocumentSnapshot
	err := withRetry("read", collection, documentId, nil, func(ctx context.Context) error {
		s, e := db.Client.Collection(collection).Doc(documentId).Get(ctx)
		if e != nil {
			return e
		}
		snapshot = s
		return nil
	})
	if err != nil {
		return fmt.Errorf("error when reading document at %s/%s with an error of: %w", collection, documentId, err)
	}

	return snapshot.DataTo(v)
}

func (db *DatabaseConn) CreateEmptyCollection(collection string, docName string) error {
	ctx := context.Background()

	_, err := db.Client.Collection(collection).Doc(docName).Set(ctx, 0)
	if err != nil {
		return fmt.Errorf("error in Creating empty document at %s: %v", collection, err)
	}
	return nil
}

func (db *DatabaseConn) CreateOrUpdateDocument(collection string, documentId string, v any) error {
	err := withRetry("write", collection, documentId, v, func(ctx context.Context) error {
		_, e := db.Client.Collection(collection).Doc(documentId).Set(ctx, v)
		return e
	})
	if err != nil {
		return fmt.Errorf("error in Updating/Creating document at %s/%s: %w", collection, documentId, err)
	}
	return nil
}

// UpdateDocumentField updates a single field on a document, with the same
// slow/failed-op instrumentation as the other wrapper methods. Added for the
// pick path's playerState field update — the exact call that hit a 60s
// DeadlineExceeded and froze draft 2024-fast-draft-1381 (2026-06-10), and the
// only pick-path write that previously bypassed the timed wrapper.
func (db *DatabaseConn) UpdateDocumentField(collection string, documentId string, fieldPath string, value any) error {
	err := withRetry("update-field", collection, documentId, value, func(ctx context.Context) error {
		_, e := db.Client.Collection(collection).Doc(documentId).Update(ctx, []firestore.Update{
			{Path: fieldPath, Value: value},
		})
		return e
	})
	if err != nil {
		return fmt.Errorf("error updating field %s at %s/%s: %w", fieldPath, collection, documentId, err)
	}
	return nil
}

func (db *DatabaseConn) ReturnNumOfDocumentsInCollection(collection string) (int, error) {
	iter := db.Client.Collection(collection).Documents(context.Background())
	data, err := iter.GetAll()
	if err != nil {
		return -1, err
	}

	return len(data), nil
}

func (db *DatabaseConn) DeleteDocument(collection, documentId string) error {
	ctx := context.Background()

	docRef := db.Client.Collection(collection).Doc(documentId)
	if docRef == nil {
		fmt.Println("doc ref was nil")
	}
	_, err := docRef.Delete(ctx)
	if err != nil {
		fmt.Println(err)
		return err
	}

	return nil
}
