package utils

import (
	"context"
	"encoding/json"
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

func logDbOp(op, collection, documentId string, start time.Time, opErr error, v any) {
	d := time.Since(start)
	if opErr == nil && d < slowOpThreshold {
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
	}
	fmt.Printf(`{"severity":"%s","event":"%s","op":"%s","path":"%s/%s","ms":%d,"sizeBytes":%d,"error":%q}`+"\n",
		severity, event, op, collection, documentId, d.Milliseconds(), sizeBytes, errStr)
}

func (db *DatabaseConn) ReadDocument(collection string, documentId string, v any) error {
	ctx := context.Background()
	start := time.Now()
	snapshot, err := db.Client.Collection(collection).Doc(documentId).Get(ctx)
	logDbOp("read", collection, documentId, start, err, nil)
	if err != nil {
		return fmt.Errorf("error when reading document at %s/%s with an error of: %v", collection, documentId, err)
	}

	err = snapshot.DataTo(v)
	if err != nil {
		return err
	}
	return nil
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
	ctx := context.Background()
	start := time.Now()
	_, err := db.Client.Collection(collection).Doc(documentId).Set(ctx, v)
	logDbOp("write", collection, documentId, start, err, v)
	if err != nil {
		return fmt.Errorf("error in Updating/Creating document at %s/%s: %v", collection, documentId, err)
	}
	return nil
}

// UpdateDocumentField updates a single field on a document, with the same
// slow/failed-op instrumentation as the other wrapper methods. Added for the
// pick path's playerState field update — the exact call that hit a 60s
// DeadlineExceeded and froze draft 2024-fast-draft-1381 (2026-06-10), and the
// only pick-path write that previously bypassed the timed wrapper.
func (db *DatabaseConn) UpdateDocumentField(collection string, documentId string, fieldPath string, value any) error {
	ctx := context.Background()
	start := time.Now()
	_, err := db.Client.Collection(collection).Doc(documentId).Update(ctx, []firestore.Update{
		{Path: fieldPath, Value: value},
	})
	logDbOp("update-field", collection, documentId, start, err, value)
	if err != nil {
		return fmt.Errorf("error updating field %s at %s/%s: %v", fieldPath, collection, documentId, err)
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
