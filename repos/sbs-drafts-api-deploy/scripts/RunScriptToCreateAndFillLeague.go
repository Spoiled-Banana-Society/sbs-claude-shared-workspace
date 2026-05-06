package main

import (
	"fmt"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

func main() {
	utils.NewDatabaseClient(true)
	users := [10]string{
		"0x27fe00a5a1212e9294b641ba860a383783016c67",
		"0x6fbc575c7471482c792fe3658130d93aa8b9fdaf",
		"0xe93465401ca4b7e5c9e25027bf304fdfc14b6e9e",
		"0x2f4ea680c9301f14a7237506def4a06ac04d8904",
		"0xdda01e3d70b8a09bd5fe334e3bec596c0c988ae0",
		"0x87d142eef9a28a7a23aef8ef1a9c10851a6c6f98",
		"0x552a38897e2aa0f701fdf8bf7041a147f7700dd2",
		"0xe08e1e1868766ba7a6c61f1c3e23c28a2a9e1794",
		"0x9beb80ed2717afb5e02b39c35e712a0571b73b69",
		"0xaa5cb8b10990a51fbd8a647d61c370282c42c976",
	}

	//_, err := utils.Db.Client.Collection("draftTokens").DocumentRefs(context.Background()).GetAll()
	//if err != nil {
	//	fmt.Println("Error reading ")
	//}
	// fetch the last highest one? - no
	tokenId := 100000 + (10*12)

	for i := 0; i < len(users); i++ {
		userAddress := users[i]
		_, err := models.MintDraftTokenInDb(fmt.Sprintf("%d", tokenId), userAddress)
		if err != nil {
			fmt.Println("error minting token: ", err)
			return
		}

		res, err := models.JoinLeagues(userAddress, 1, "fast")
		if err != nil {
			fmt.Println("Error joining leagues: ", err)
			return
		}
		fmt.Printf("added Card %s to League %s\r", res[0].CardId, res[0].LeagueId)
		tokenId++
	}
	fmt.Println("Minted and added 10 cards to a league so a draft should be starting in a minute")
}
