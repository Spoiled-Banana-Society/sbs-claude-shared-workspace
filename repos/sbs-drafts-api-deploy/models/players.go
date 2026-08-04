package models

import (
	"context"
	"fmt"
	"strings"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type PlayerStateInfo struct {
	// unique player Id will probably just be the team and position such as BUFQB
	PlayerId string `json:"playerId"`
	// display name for front end
	DisplayName string `json:"displayName"`
	// team of the player
	Team string `json:"team"`
	// position of player
	Position string `json:"position"`
	// address of the user who drafted this player
	OwnerAddress string `json:"ownerAddress"`
	// number pick that this player was selected.... will default to nil in the database
	PickNum int `json:"pickNum"`
	// the round which this player was drafted in
	Round int `json:"round"`
}

type StateMap struct {
	Players map[string]PlayerStateInfo
}

type PlayerRanking struct {
	PlayerId string  `json:"playerId"`
	Rank     int64   `json:"rank"`
	Score    float64 `json:"score"`
}

type UserRankings struct {
	Ranking []PlayerRanking `json:"ranking"`
}

type StatsObject struct {
	PlayerId        string   `json:"playerId"`
	AverageScore    float64  `json:"averageScore"`
	HighestScore    float64  `json:"highestScore"`
	Top5Finishes    int64    `json:"top5Finishes"`
	ByeWeek         string   `json:"byeWeek"`
	ADP             float64  `json:"adp"`
	PlayersFromTeam []string `json:"playersFromTeam"`
}

type DraftPlayerRanking struct {
	// unique player Id will probably just be the team and position such as BUFQB
	PlayerId string `json:"playerId"`
	// holds the state object for player
	PlayerStateInfo PlayerStateInfo `json:"playerStateInfo"`
	Stats           StatsObject     `json:"stats"`
	Ranking         PlayerRanking   `json:"ranking"`
}

func CreateRankingObject(ranking PlayerRanking, stats StatsObject, info PlayerStateInfo) DraftPlayerRanking {
	return DraftPlayerRanking{
		PlayerId:        info.PlayerId,
		PlayerStateInfo: info,
		Stats:           stats,
		Ranking:         ranking,
	}
}

func GetUserRankingsFromDrafts(ownerId string) (*UserRankings, error) {
	r := UserRankings{
		Ranking: make([]PlayerRanking, 0),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", &r)
	if err != nil {
		if ok := strings.Contains(strings.ToLower(err.Error()), "notfound"); ok {

			err := utils.Db.ReadDocument("playerStats2026", "rankings", &r)
			if err != nil {
				return nil, err
			}

			err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", r)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}

	} else if len(r.Ranking) == 0 {
		fmt.Println("made it into the second if statement")
		err := utils.Db.ReadDocument("playerStats2026", "rankings", &r)
		if err != nil {
			return nil, err
		}

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/drafts", ownerId), "rankings", r)
		if err != nil {
			return nil, err
		}
	}

	return &r, nil
}

type StatsMap struct {
	Players map[string]StatsObject `json:"players"`
}

func ReturnPlayerStateWithRankings(ownerId string, draftId string) ([]DraftPlayerRanking, error) {
	fmt.Println("Inside of returnPlayerStateWIthRankins")
	userRankings, err := GetUserRankingsFromDrafts(ownerId)
	if err != nil {
		return nil, err
	}
	//fmt.Println("Got user rankings: ", userRankings)

	state := make(map[string]PlayerStateInfo)
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "playerState", &state)
	if err != nil {
		return nil, err
	}
	if len(state) == 0 {
		fmt.Println("state is empty")
	}

	stats := StatsMap{
		Players: make(map[string]StatsObject),
	}
	err = utils.Db.ReadDocument("playerStats2026", "playerMap", &stats)
	if err != nil {
		return nil, err
	}

	res := make([]DraftPlayerRanking, 0)

	for _, rank := range userRankings.Ranking {
		stateInfo := state[rank.PlayerId]
		if stateInfo.PlayerId == "" {
			fmt.Println("This should not be empty")
		}
		obj := CreateRankingObject(rank, stats.Players[rank.PlayerId], stateInfo)
		res = append(res, obj)
	}

	return res, nil
}

func (pick *PlayerStateInfo) UpdateDraftSummary(draftId string) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}
	summary := DraftSummary{
		Summary: make([]DraftSummaryObject, 0),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
	if err != nil {
		return err
	}

	if pick.PickNum > 150 {
		fmt.Println("ERROR updating draft summary because pick number is greater than 150")
		return fmt.Errorf("error updating draft summary because pick number is greater than 150")
	}

	if summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId == "" {
		summary.Summary[pick.PickNum-1].PlayerInfo = *pick

		err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
		if err != nil {
			return err
		}
		fmt.Printf("Updated Draft Summary For Pick %d: %v\r", pick.PickNum-1, summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId)
		return nil
	}

	// Replay of OUR OWN identical pick (same player, owner, slot) — happens
	// when a mid-pick failure is retried after the summary write already
	// landed. That's a success, not a conflict: the slot already holds
	// exactly what we came to write. Part of the 2026-06-10 freeze fix —
	// retries are only safe if every step treats its own replay as done.
	existing := summary.Summary[pick.PickNum-1].PlayerInfo
	if existing.PlayerId == pick.PlayerId && existing.OwnerAddress == pick.OwnerAddress && existing.PickNum == pick.PickNum {
		fmt.Printf("Draft summary already holds this exact pick (replay) — treating as success. Pick %d: %v\r", pick.PickNum-1, pick.PlayerId)
		return nil
	}

	// A DIFFERENT pick occupies the slot — real conflict, keep rejecting.
	fmt.Printf("New Pick: %v, is submitting a pick that already shows being drafted in the summary with %v\r", *pick, summary.Summary[pick.PickNum-1])
	return fmt.Errorf("new Pick: %v, is submitting a pick that already shows being drafted in the summary with %v\r", *pick, summary.Summary[pick.PickNum-1])
}

func RevertAdditionToDraftSummary(draftId string, pick PlayerStateInfo) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}
	summary := DraftSummary{
		Summary: make([]DraftSummaryObject, 0),
	}
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
	if err != nil {
		return err
	}

	if summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId != pick.PlayerId {
		fmt.Println("It appears that this pick is not actually in the summary")
		return fmt.Errorf("it appears that this pick is not actually in the summary so we are returning and not messing with the sumary")
	}

	summary.Summary[pick.PickNum-1].PlayerInfo.DisplayName = ""
	summary.Summary[pick.PickNum-1].PlayerInfo.PlayerId = ""
	summary.Summary[pick.PickNum-1].PlayerInfo.Team = ""
	summary.Summary[pick.PickNum-1].PlayerInfo.Position = ""

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state", draftId), "summary", &summary)
	if err != nil {
		return err
	}
	return nil

}

func (pick *PlayerStateInfo) UpdatePlayerInDraft(draftId string) error {
	if pick.PlayerId == "" {
		return fmt.Errorf("cannot update this pick in the draft player state as the pick object is nil")
	}
	// GUARD (2026-07-23, dup-pick incident BBB #240): playerState was the only
	// pick store with NO conflict check — when a racing second commit landed for
	// the same turn (buzzer manual pick vs auto-pick timer, or a redelivered
	// auto-pick task), the summary/roster guards rejected the loser but this
	// blind field write accepted it, stamping a SECOND player with the same
	// PickNum. That player was owned here but on no roster and in no summary —
	// invisible on the board and undraftable ("vanished"). 189 phantoms across
	// 186 drafts were cleaned on 2026-07-23; this guard stops new ones.
	//
	// Same write as before (single field-path update), now read-guarded in a
	// transaction that mirrors the other stores' guards:
	//   - our own identical entry already present → replay → success. Keeps
	//     mid-pick retries + the watchdog re-assert working (2026-06-10 rule:
	//     every step treats its own replay as done).
	//   - any OTHER player already owned with this PickNum → reject, no write.
	// No ordering, lock, or advance changes — a loser here already returned an
	// error from its roster write today; now it just doesn't leave a phantom.
	docRef := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Doc("playerState")
	err := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(docRef) // tx.Get, NOT ref.Get!
		if err != nil {
			return err
		}
		var state map[string]PlayerStateInfo
		if err := doc.DataTo(&state); err != nil {
			return err
		}
		if own, ok := state[pick.PlayerId]; ok && own.OwnerAddress == pick.OwnerAddress && own.PickNum == pick.PickNum {
			// Replay of our own already-landed write — success, not a conflict.
			return nil
		}
		for id, p := range state {
			if id != pick.PlayerId && p.OwnerAddress != "" && p.PickNum == pick.PickNum {
				fmt.Printf(`{"severity":"ERROR","draftId":"%s","event":"pick_playerstate_conflict_rejected","pickNum":%d,"incoming":"%s","holder":"%s","owner":"%s"}`+"\n",
					draftId, pick.PickNum, pick.PlayerId, id, pick.OwnerAddress)
				return fmt.Errorf("playerState conflict: pick %d already held by %s, rejecting %s", pick.PickNum, id, pick.PlayerId)
			}
		}
		return tx.Update(docRef, []firestore.Update{{Path: pick.PlayerId, Value: pick}})
	})
	if err != nil {
		return fmt.Errorf("error updating playerState field %s at drafts/%s/state: %w", pick.PlayerId, draftId, err)
	}
	return nil
}

// IsPlayerStateConflict reports whether err came from the pick-slot guard in
// UpdatePlayerInDraft (a DIFFERENT player already recorded at this PickNum),
// as opposed to a transport/permission failure. Only the watchdog acts on it.
func IsPlayerStateConflict(err error) bool {
	return err != nil && strings.Contains(err.Error(), "playerState conflict: pick ")
}

// anyRosterHasPlayer reports whether playerId appears on ANY owner's roster in
// this draft, across every position slot. Deliberately draft-wide rather than
// per-owner: a released player must be free for everyone, so if anybody holds
// it the release is unsafe no matter who.
func anyRosterHasPlayer(state RosterState, playerId string) bool {
	for _, r := range state.Rosters {
		if r == nil {
			continue
		}
		for _, list := range [][]RosterPlayer{r.QB, r.RB, r.WR, r.TE, r.DST} {
			if rosterHasPlayer(list, playerId) {
				return true
			}
		}
	}
	return false
}

// ForcePlayerStateToSummaryPick resolves a SPLIT pick — the summary and
// playerState naming different players for the same slot — by making
// playerState agree with the summary.
//
// ⚠️ WATCHDOG ONLY. Never call this from the live pick path. It exists because
// two auto-pick runs for one slot can each win a DIFFERENT state doc (the three
// writes in ProcessNewPick fan out concurrently), leaving summary+rosters on one
// player and playerState on another. Both runs then abort before advancing, so
// the draft is dead and the watchdog's own re-assert can never get past the
// conflict guard — it hits the very rejection that describes the split. Seen
// 2026-08-01 on 2026-fast-draft-364 pick 9: summary+roster NE-WR1, playerState
// MIN-WR1; 20 minutes dead, repaired by hand.
//
// The summary is the authority: it is what every player already sees on the
// board, and UpdateRosterFromPick derives from the same pick, so a healthy
// record has summary and rosters agreeing. We therefore stamp the summary's
// pick and release the impostor back into the pool.
//
// REFUSES rather than guesses when the evidence is not clean:
//   - the impostor is on SOMEONE'S ROSTER → that is a deeper corruption than a
//     lost race, and releasing a rostered player would take a real pick away.
//   - no impostor is actually present → nothing to heal; let the caller's
//     normal path run.
func ForcePlayerStateToSummaryPick(draftId string, pick PlayerStateInfo) error {
	if pick.PlayerId == "" || pick.PickNum <= 0 {
		return fmt.Errorf("force playerState: refusing, incomplete pick %+v", pick)
	}

	// Roster check FIRST, outside the transaction: rosters live in a different
	// document, and a player who legitimately sits on a roster must never be
	// released. Read-only, so ordering here is safe.
	rosters := RosterState{Rosters: make(map[string]*DraftStateRoster)}
	if err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state", draftId), "rosters", &rosters); err != nil {
		return fmt.Errorf("force playerState: cannot read rosters to verify: %w", err)
	}

	docRef := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/state", draftId)).Doc("playerState")
	return utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(docRef)
		if err != nil {
			return err
		}
		var state map[string]PlayerStateInfo
		if err := doc.DataTo(&state); err != nil {
			return err
		}

		updates := []firestore.Update{}
		for id, p := range state {
			if id == pick.PlayerId || p.OwnerAddress == "" || p.PickNum != pick.PickNum {
				continue
			}
			if anyRosterHasPlayer(rosters, id) {
				return fmt.Errorf("force playerState: refusing, impostor %s at pick %d sits on a roster", id, pick.PickNum)
			}
			released := p
			released.OwnerAddress = ""
			released.PickNum = 0
			released.Round = 0
			updates = append(updates, firestore.Update{Path: id, Value: released})
			fmt.Printf(`{"severity":"WARNING","draftId":"%s","event":"watchdog_playerstate_split_healed","pickNum":%d,"released":"%s","asserted":"%s","owner":"%s"}`+"\n",
				draftId, pick.PickNum, id, pick.PlayerId, pick.OwnerAddress)
		}
		if len(updates) == 0 {
			return fmt.Errorf("force playerState: no conflicting holder found at pick %d", pick.PickNum)
		}

		updates = append(updates, firestore.Update{Path: pick.PlayerId, Value: pick})
		return tx.Update(docRef, updates)
	})
}
