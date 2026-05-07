package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type ScoreDraftTokensEndpoint struct {
	Scores   []models.Score `json:"scores"`
	GameWeek string         `json:"gameWeek"`
}

func main() {
	utils.NewDatabaseClient(true)

	var scores models.Scores
	err := utils.Db.ReadDocument("scores", "2024REG-17", &scores)
	if err != nil {
		panic(err)
	}
	fmt.Println(len(scores.FantasyPoints))

	reqData := &ScoreDraftTokensEndpoint{
		Scores:   scores.FantasyPoints,
		GameWeek: "2024REG-17",
	}

	jsonData, err := json.Marshal(reqData)
	if err != nil {
		fmt.Printf("Error marshalling JSON: %v\n", err)
		return
	}

	// Create the POST request
	url := "https://sbs-cloud-functions-api-671861674743.us-central1.run.app/scoreDraftTokens"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Error creating request: %v\n", err)
		return
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")

	// Send the request using an HTTP client
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error making POST request: %v\n", err)
		return
	}
	defer resp.Body.Close()

	// Check the response
	if resp.StatusCode == http.StatusOK {
		fmt.Println("POST request successful!")
	} else {
		fmt.Printf("POST request failed with status: %s\n", resp.Status)
	}
}
