package utils

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"os"

	secretmanager "cloud.google.com/go/secretmanager/apiv1"
	secretmanagerpb "cloud.google.com/go/secretmanager/apiv1/secretmanagerpb"
	"github.com/go-redis/redis/v8"
)

var SubConn *redis.Client
var PubConn *redis.Client

type RedisMessage struct {
	EventType string `json:"eventType"`
	Sender    string `json:"sender"`
	Payload   []byte `json:"payload"`
}

// All the possible event types for a redis message
const (
	CompleteSubChannel  = "complete"
	TimerSubChannel     = "timer"
	PickSubChannel      = "pick"
	InfoSubChannel      = "info"
	StatusSubChannel    = "status"
	CountdownSubChannel = "countdown"
)

func (rm *RedisMessage) MarshalBinary() (data []byte, err error) {
	return json.Marshal(rm)
}

func (rm *RedisMessage) UnmarshalBinary(data []byte) (err error) {
	return json.Unmarshal(data, rm)
}

// redis url should be redis://10.58.49.195:6379

// redis url for sbs-prod-env: redis://10.90.138.203
func CreateRedisClient() {
	url := ""
	password := ""
	useTLS := false

	// Check for explicit REDIS_URL env var first (used by staging with external Redis)
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		url = redisURL
		password = os.Getenv("REDIS_PASSWORD")
		useTLS = os.Getenv("REDIS_TLS") == "true"
	} else {
		env := os.Getenv("ENVIRONMENT")
		if env == "prod" {
			url = "10.74.187.59:6379"
		} else {
			url = "10.39.4.155:6379"
		}
	}

	fmt.Println("Creating client")
	fmt.Printf("Redis url: %s\r", url)

	opts := &redis.Options{
		Network:  "tcp",
		Addr:     url,
		Password: password,
		DB:       0,
	}
	if useTLS {
		opts.TLSConfig = &tls.Config{}
	}

	r := redis.NewClient(opts)
	if err := r.Ping(context.Background()).Err(); err != nil {
		fmt.Println(err)
		panic(err)
	}
	SubConn = r

	p := redis.NewClient(opts)
	if err := p.Ping(context.Background()).Err(); err != nil {
		fmt.Println(err)
		panic(err)
	}
	PubConn = p
}

// data:"10.58.49.195:6379" data_crc32c:166175010

// prod: 10.56.167.139
type GoogleSecret struct {
	Data        string `json:"data"`
	Data_crc32c int64  `json:"data_crc32c"`
}

func ReturnRedisUrl() (string, error) {
	ctx := context.Background()
	client, err := secretmanager.NewClient(ctx)
	if err != nil {
		fmt.Println("Error in creating secret manager client")
		return "", err
	}
	defer client.Close()

	env := os.Getenv("ENVIRONMENT")
	var pathLocation string
	if env == "prod" {
		pathLocation = os.Getenv("PROD_REDIS_URL_LOCATION")
		fmt.Println("Path location: ", pathLocation)
	} else {
		pathLocation = os.Getenv("TEST_REDIS_URL_LOCATION")
		fmt.Println("Path location: ", pathLocation)
	}

	req := &secretmanagerpb.AccessSecretVersionRequest{
		Name: pathLocation,
	}

	res, err := client.AccessSecretVersion(ctx, req)
	if err != nil {
		fmt.Println("Error in accessing secret version of client")
		return "", err
	}

	url := string(res.Payload.GetData())

	return url, nil
}
