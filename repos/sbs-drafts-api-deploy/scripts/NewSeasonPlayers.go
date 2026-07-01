package main

import (
	"io/ioutil"
	"net/http"
	"encoding/json"
	"context"
	"fmt"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
)

type StatsObject struct {
	PlayerId        string   `json:"playerId"`
	AverageScore    float64  `json:"averageScore"`
	HighestScore    float64  `json:"highestScore"`
	Top5Finishes    int64    `json:"top5Finishes"`
	ByeWeek         string   `json:"byeWeek"`
	ADP             float64  `json:"adp"`
	PlayersFromTeam []string `json:"playersFromTeam"`
}

type PlayerAPIObjects []struct {
	PlayerID                            int     `json:"PlayerID"`
	Team                                string  `json:"Team"`
	Number                              int     `json:"Number"`
	FirstName                           string  `json:"FirstName"`
	LastName                            string  `json:"LastName"`
	Position                            string  `json:"Position"`
	Status                              string  `json:"Status"`
	Height                              string  `json:"Height"`
	Weight                              int     `json:"Weight"`
	BirthDate                           string  `json:"BirthDate"`
	College                             string  `json:"College"`
	Experience                          int     `json:"Experience"`
	FantasyPosition                     string  `json:"FantasyPosition"`
	Active                              bool    `json:"Active"`
	PositionCategory                    string  `json:"PositionCategory"`
	Name                                string  `json:"Name"`
	Age                                 int     `json:"Age"`
	ExperienceString                    string  `json:"ExperienceString"`
	BirthDateString                     string  `json:"BirthDateString"`
	PhotoURL                            string  `json:"PhotoUrl"`
	ByeWeek                             int     `json:"ByeWeek"`
	UpcomingGameOpponent                any     `json:"UpcomingGameOpponent"`
	UpcomingGameWeek                    int     `json:"UpcomingGameWeek"`
	ShortName                           string  `json:"ShortName"`
	AverageDraftPosition                float64 `json:"AverageDraftPosition"`
	DepthPositionCategory               string  `json:"DepthPositionCategory"`
	DepthPosition                       string  `json:"DepthPosition"`
	DepthOrder                          int     `json:"DepthOrder"`
	DepthDisplayOrder                   int     `json:"DepthDisplayOrder"`
	CurrentTeam                         string  `json:"CurrentTeam"`
	CollegeDraftTeam                    string  `json:"CollegeDraftTeam"`
	CollegeDraftYear                    int     `json:"CollegeDraftYear"`
	CollegeDraftRound                   int     `json:"CollegeDraftRound"`
	CollegeDraftPick                    int     `json:"CollegeDraftPick"`
	IsUndraftedFreeAgent                bool    `json:"IsUndraftedFreeAgent"`
	HeightFeet                          int     `json:"HeightFeet"`
	HeightInches                        int     `json:"HeightInches"`
	UpcomingOpponentRank                any     `json:"UpcomingOpponentRank"`
	UpcomingOpponentPositionRank        any     `json:"UpcomingOpponentPositionRank"`
	CurrentStatus                       string  `json:"CurrentStatus"`
	UpcomingSalary                      any     `json:"UpcomingSalary"`
	FantasyAlarmPlayerID                int     `json:"FantasyAlarmPlayerID"`
	SportRadarPlayerID                  string  `json:"SportRadarPlayerID"`
	RotoworldPlayerID                   int     `json:"RotoworldPlayerID"`
	RotoWirePlayerID                    int     `json:"RotoWirePlayerID"`
	StatsPlayerID                       int     `json:"StatsPlayerID"`
	SportsDirectPlayerID                int     `json:"SportsDirectPlayerID"`
	XMLTeamPlayerID                     any     `json:"XmlTeamPlayerID"`
	FanDuelPlayerID                     int     `json:"FanDuelPlayerID"`
	DraftKingsPlayerID                  int     `json:"DraftKingsPlayerID"`
	YahooPlayerID                       int     `json:"YahooPlayerID"`
	InjuryStatus                        any     `json:"InjuryStatus"`
	InjuryBodyPart                      any     `json:"InjuryBodyPart"`
	InjuryStartDate                     any     `json:"InjuryStartDate"`
	InjuryNotes                         any     `json:"InjuryNotes"`
	FanDuelName                         string  `json:"FanDuelName"`
	DraftKingsName                      string  `json:"DraftKingsName"`
	YahooName                           string  `json:"YahooName"`
	FantasyPositionDepthOrder           int     `json:"FantasyPositionDepthOrder"`
	InjuryPractice                      any     `json:"InjuryPractice"`
	InjuryPracticeDescription           any     `json:"InjuryPracticeDescription"`
	DeclaredInactive                    bool    `json:"DeclaredInactive"`
	UpcomingFanDuelSalary               any     `json:"UpcomingFanDuelSalary"`
	UpcomingDraftKingsSalary            any     `json:"UpcomingDraftKingsSalary"`
	UpcomingYahooSalary                 any     `json:"UpcomingYahooSalary"`
	TeamID                              int     `json:"TeamID"`
	GlobalTeamID                        int     `json:"GlobalTeamID"`
	FantasyDraftPlayerID                int     `json:"FantasyDraftPlayerID"`
	FantasyDraftName                    string  `json:"FantasyDraftName"`
	UsaTodayPlayerID                    int     `json:"UsaTodayPlayerID"`
	UsaTodayHeadshotURL                 string  `json:"UsaTodayHeadshotUrl"`
	UsaTodayHeadshotNoBackgroundURL     string  `json:"UsaTodayHeadshotNoBackgroundUrl"`
	UsaTodayHeadshotUpdated             string  `json:"UsaTodayHeadshotUpdated"`
	UsaTodayHeadshotNoBackgroundUpdated string  `json:"UsaTodayHeadshotNoBackgroundUpdated"`
	PlayerSeason                        any     `json:"PlayerSeason"`
	LatestNews                          []any   `json:"LatestNews"`
}

type StatsMap struct {
	Players map[string]StatsObject `json:"players"`
}

func main() {
	oldSeasonCollection := "playerStats2023"
	newSeasonCollection := "playerStats2024"

	positions := ["DST", "QB", "WR1", "WR2", "RB1", "RB2", "TE"]

	ctx := context.Background()
	utils.NewDatabaseClient(true)

	oldPlayersMap := StatsMap{
		Players: make(map[string]StatsObject),
	}
	data, err := utils.Db.Client.Collection(Sprintf("%s", oldSeasonCollection)).Doc("newPlayerMap").Get(ctx)
	if err != nil {
		fmt.Println("Error reading newPlayerMap: ", err)
		return
	}

	err = data.DataTo(&oldPlayersMap)
	if err != nil {
		fmt.Println("Error reading data into oldPlayersMap: ", err)
		return
	}

	newPlayersMap := StatsMap{
		Players: make(map[string]StatsObject),
	}

	teamInfo := make(map[string]PlayerAPIObjects)

	for playerID, playerMap := range oldPlayersMap {
		// fetch players on team that fill this position
		teamPosSlice = strings.SplitN(playerID, "-", 1)

		if teamInfo[teamPosSlice[0]] == nil {
			// fetch the info from sports data
			res, err := http.Get(Sprintf("https://api.sportsdata.io/v3/nfl/scores/json/Players/%s?key=cc1e7d75df054c6c82c4ff2f02ded616", teamPosSlice[0]))
			if err != nil {
				fmt.Printf("error making http request: %s\n", err)
				return
			}

			defer resp.Body.Close()
			body, err := ioutil.ReadAll(res.Body)
			if err != nil {
				log.Println(err)
				return
			}

			var playersMap PlayerAPIObjects
			err = json.Unmarshal(body, playerMap)
			if err != nil {
				fmt.Println(err)
				return
			}

			teamInfo[teamPosSlice[0]] = playersMap
		}

		

	}
}
