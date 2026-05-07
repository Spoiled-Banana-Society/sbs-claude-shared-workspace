package models

import (
	"fmt"
	"strings"
	"github.com/Spoiled-Banana-Society/SBS-Football-Drafts/utils"
)

type PlayerRanking struct {
	PlayerId string  `json:"playerId"`
	Rank     int64   `json:"rank"`
	Score    float64 `json:"score"`
}

type UserRankings struct {
	Ranking []PlayerRanking `json:"ranking"`
}

type RosterPlayer struct {
	Team        string `json:"team"`
	PlayerId    string `json:"playerId"`
	DisplayName string `json:"displayName"`
}

type TokenRoster struct {
	DST []RosterPlayer `json:"DST"`
	QB  []RosterPlayer `json:"QB"`
	RB  []RosterPlayer `json:"RB"`
	TE  []RosterPlayer `json:"TE"`
	WR  []RosterPlayer `json:"WR"`
}

type DraftStateRoster struct {
	DST []RosterPlayer `json:"DST"`
	QB  []RosterPlayer `json:"QB"`
	RB  []RosterPlayer `json:"RB"`
	TE  []RosterPlayer `json:"TE"`
	WR  []RosterPlayer `json:"WR"`
	PFP PfpData        `json:"PFP"`
}

type RosterState struct {
	Rosters map[string]*DraftStateRoster `json:"rosters"`
}

type PlayerDraftInfo struct {
	ADP int64 `json:"adp"`
	ByeWeek string `json:"bye"`
	PlayerId string `json:"playerId"`
}

type PlayerMap struct {
	Players map[string]*PlayerDraftInfo
}

func UpdateRosterFromPick(draftId, address, teamName, position, playerId, displayName string, roundNum int) error {
	data := &RosterState{
		Rosters: make(map[string]*DraftStateRoster),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &data)
	if err != nil {
		fmt.Println("Rosters doc not found, initializing empty rosters for draft: ", draftId)
		// Continue with empty data — first pick will create the doc via CreateOrUpdateDocument below
	}

	// Initialize roster for this address if it doesn't exist yet
	if data.Rosters[address] == nil {
		data.Rosters[address] = &DraftStateRoster{}
	}

	if strings.ToLower(position) == "qb" {
		data.Rosters[address].QB = append(data.Rosters[address].QB, RosterPlayer{Team: teamName, PlayerId: playerId, DisplayName: displayName})
	} else if strings.ToLower(position) == "rb" {
		data.Rosters[address].RB = append(data.Rosters[address].RB, RosterPlayer{Team: teamName, PlayerId: playerId, DisplayName: displayName})
	} else if strings.ToLower(position) == "wr" {
		data.Rosters[address].WR = append(data.Rosters[address].WR, RosterPlayer{Team: teamName, PlayerId: playerId, DisplayName: displayName})
	} else if strings.ToLower(position) == "te" {
		data.Rosters[address].TE = append(data.Rosters[address].TE, RosterPlayer{Team: teamName, PlayerId: playerId, DisplayName: displayName})
	} else if strings.ToLower(position) == "dst" {
		data.Rosters[address].DST = append(data.Rosters[address].DST, RosterPlayer{Team: teamName, PlayerId: playerId, DisplayName: displayName})
	}

	size := 0
	size += len(data.Rosters[address].QB)
	size += len(data.Rosters[address].RB)
	size += len(data.Rosters[address].WR)
	size += len(data.Rosters[address].TE)
	size += len(data.Rosters[address].DST)

	if size > roundNum {
		fmt.Println("This user is trying to pick an extra player and would have more players than allowed in round ", roundNum)
		return fmt.Errorf("error this user is trying to pick an extra player and would have more players than allowed in round %d", roundNum)
	}

	fmt.Printf("Just added player %s to roster to make a total of %d players on the roster\r", playerId, (len(data.Rosters[address].DST) + len(data.Rosters[address].QB) + len(data.Rosters[address].RB) + len(data.Rosters[address].TE) + len(data.Rosters[address].WR)))

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &data)
	if err != nil {
		fmt.Println("Error updating rosters in draft ", draftId)
		return err
	}

	return nil
}

func GetUserRankings(ownerId string) (*UserRankings, error) {
	var r UserRankings
	err := utils.Db.ReadDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", &r)

	if err != nil {
		return nil, err
	}

	return &r, nil
}

func GetDraftADP(draftId string) (*UserRankings, error) {
	var league League
	var adpSlice []PlayerDraftInfo

	err := utils.Db.ReadDocument("drafts", draftId, &league)
	if err != nil {
		return nil, err
	}

	adpSlice = league.ADP

	playerRanksLength := len(adpSlice)

	// iterate over map and sort by adp
	userRanks := UserRankings{
		Ranking: make([]PlayerRanking, playerRanksLength),
	}

	for i := 0; i < len(adpSlice); i++ {
		player := PlayerRanking{
			PlayerId: adpSlice[i].PlayerId,
			Rank: int64(i + 1),
		}

		userRanks.Ranking[i] = player
	}

	if err != nil {
		return nil, err
	}

	return &userRanks, nil
}
