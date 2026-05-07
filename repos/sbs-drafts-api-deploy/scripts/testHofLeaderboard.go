package main

import (
	"fmt"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func main() {
	utils.NewDatabaseClient(true)
	leaderboard, err := models.ReturnHallOfFamePlayoffLeaderboard("2024REG-15", "ScoreSeason", "0xd2e8530f30cc43ede9b0403f2461320d7034ed8b")
	if err != nil {
		panic(err)
	}

	fmt.Println(leaderboard.OwnersTokens)
}
