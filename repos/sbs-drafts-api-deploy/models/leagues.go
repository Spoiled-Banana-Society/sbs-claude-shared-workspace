package models

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

// seasonYear is the single source of truth for the season prefix on every draft
// id ("<seasonYear>-<type>-draft-<n>"). All three places that build or scan a
// draft id MUST use this const so the year can never be half-changed (scanning
// one year while creating another would spawn empty leagues forever). The
// player data is already 2026 (playerStats2026); this only governs the draft-id
// label and is independent of the on-chain contract and the VRF systems.
const seasonYear = "2026"

// normalizePassType folds anything that isn't explicitly "free" into "paid"
// (legacy tokens have an empty PassType and are treated as paid).
func normalizePassType(pt string) string {
	if pt == "free" {
		return "free"
	}
	return "paid"
}

// isSpecialWheelPass reports whether a token's Level marks it as a HOF/Jackpot
// pass. Those are won on the wheel and are RESTRICTED to their own special
// (wheel) slow draft — they may be sold while the round is filling, but must
// NEVER be spent to enter a regular fast/slow main-lobby draft. The regular
// league picker (selectTokensByType) excludes them so the same pass can't be
// double-used (the bug that let a HOF wheel pass be drafted into a normal
// league: a free wheel HOF pass with a low id was picked ahead of a real free
// pass). Empty / "Pro" = an ordinary pass and stays eligible.
func isSpecialWheelPass(level string) bool {
	switch strings.TrimSpace(level) {
	case "Hall of Fame", "Jackpot":
		return true
	default:
		return false
	}
}

// selectTokensByType returns the `count` lowest-numbered tokens whose PassType
// matches `want` ('paid'|'free'), honoring the user's choice at entry. Sorts by
// numeric id (real NFT ids), with any non-numeric ids (staging stock) ordered
// after, by string — both deterministic. Errors if fewer than `count` of the
// requested type exist, so we never silently consume the wrong type.
func selectTokensByType(tokens []DraftToken, want string, count int) ([]DraftToken, error) {
	want = normalizePassType(want)
	matching := make([]DraftToken, 0, len(tokens))
	for _, t := range tokens {
		// HOF/Jackpot wheel passes are locked to their own special draft and can
		// never be consumed to enter a regular main-lobby draft — skip them here.
		if isSpecialWheelPass(t.Level) {
			continue
		}
		if normalizePassType(t.PassType) == want {
			matching = append(matching, t)
		}
	}
	if len(matching) < count {
		return nil, fmt.Errorf("not enough %s draft passes: have %d, need %d", want, len(matching), count)
	}
	sort.Slice(matching, func(i, j int) bool {
		ai, aerr := strconv.ParseInt(matching[i].CardId, 10, 64)
		bi, berr := strconv.ParseInt(matching[j].CardId, 10, 64)
		if aerr == nil && berr == nil {
			return ai < bi
		}
		if aerr == nil { // numeric before non-numeric
			return true
		}
		if berr == nil {
			return false
		}
		return matching[i].CardId < matching[j].CardId
	})
	return matching[:count], nil
}

// runConcurrently runs every fn in its own goroutine, waits for all of them
// to finish, and returns the first non-nil error (if any). Used for
// independent writes that must all complete before we return but don't depend
// on each other (e.g. the two double-spend cleanup writes, the per-user draft
// state writes). All fns always run even if one fails.
func runConcurrently(fns ...func() error) error {
	if len(fns) == 0 {
		return nil
	}
	var wg sync.WaitGroup
	errs := make([]error, len(fns))
	for i, fn := range fns {
		wg.Add(1)
		go func(i int, fn func() error) {
			defer wg.Done()
			errs[i] = fn()
		}(i, fn)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

// selectLowestPartialLeague fires up to maxLookback candidate reads
// concurrently (read returns the league and whether it exists), then scans the
// same backwards order the old sequential loop used and returns the lowest
// numbered league with 1-9 players that ownerId is not already in. Returns 0
// if none match within the window. The selection result is identical to the
// old sequential scan — only the reads are parallelized.
func selectLowestPartialLeague(startFrom int, maxLookback int, ownerId string, read func(n int) (*League, bool)) int {
	// Candidate set matches the old loop: n from startFrom down to
	// startFrom-maxLookback+1, n > 0.
	candidates := make([]int, 0, maxLookback)
	for n := startFrom; n > 0 && n > startFrom-maxLookback; n-- {
		candidates = append(candidates, n)
	}

	leagues := make([]*League, len(candidates))
	founds := make([]bool, len(candidates))
	var wg sync.WaitGroup
	for i, n := range candidates {
		wg.Add(1)
		go func(i, n int) {
			defer wg.Done()
			leagues[i], founds[i] = read(n)
		}(i, n)
	}
	wg.Wait()

	lowest := 0
	for i, n := range candidates {
		if !founds[i] || leagues[i] == nil {
			continue
		}
		l := leagues[i]
		// Wheel-won specials (Jackpot/HOF) are enterable ONLY by winning them on
		// the wheel — never hand a regular join an open seat in one (Richard,
		// 2026-06-18).
		if l.Level == "Jackpot" || l.Level == "Hall of Fame" {
			continue
		}
		if l.NumPlayers <= 0 || l.NumPlayers >= 10 {
			continue
		}
		alreadyIn := false
		for _, u := range l.CurrentUsers {
			if u.OwnerId == ownerId {
				alreadyIn = true
				break
			}
		}
		if alreadyIn {
			continue
		}
		// candidates are in descending n order; keep overwriting so the last
		// (lowest) eligible n wins — same as the old sequential scan.
		lowest = n
	}
	return lowest
}

type League struct {
	LeagueId     string            `json:"leagueId"`
	DisplayName  string            `json:"displayName"`
	CurrentUsers []LeagueUser      `json:"currentUsers"`
	NumPlayers   int               `json:"numPlayers"`
	MaxPlayers   int               `json:"maxPlayers"`
	StartDate    time.Time         `json:"startDate"`
	EndDate      time.Time         `json:"endDate"`
	DraftType    string            `json:"draftType"`
	Level        string            `json:"level"`
	IsLocked     bool              `json:"isFilled"`
	ADP          []PlayerDraftInfo `json:"ADPData"`
}

type PlayerDraftInfo struct {
	ADP      int64  `json:"adp"`
	ByeWeek  string `json:"bye"`
	PlayerId string `json:"playerId"`
}

type LeagueUser struct {
	OwnerId string `json:"ownerId"`
	TokenId string `json:"tokenId"`
}

type DraftLeagueTracker struct {
	CurrentLiveDraftCount int   `json:"currentLiveDraftCount" firestore:"CurrentLiveDraftCount"`
	CurrentSlowDraftCount int   `json:"currentScheduledDraftCount" firestore:"CurrentSlowDraftCount"`
	FilledLeaguesCount    int   `json:"filledLeaguesCount" firestore:"FilledLeaguesCount"`
	HofLeagueIds          []int `json:"hofLeagueIds" firestore:"HofLeagueIds"`
	JackpotLeagueIds      []int `json:"jackpotLeagueIds" firestore:"JackpotLeagueIds"`
	// SpecialDraftCount is the OWN sequence for wheel-won Jackpot/HOF drafts.
	// They run outside the per-100 batch entirely (never touch FilledLeaguesCount
	// or the VRF JP/HOF position lists), so the guaranteed 1+5 per 100 stays a
	// pure paid-draft pool. Names them "Special Draft Jackpot/HOF #N".
	SpecialDraftCount     int   `json:"specialDraftCount" firestore:"SpecialDraftCount"`
	// RecentFills is a short rolling window (last ~10) of batch drafts that
	// filled, each with its DraftStartTime. The slot machine reveals a draft's
	// type at DraftStartTime-39s (fill+21s); the batch-progress stream uses
	// these to gate the JP/HOF count + odds on each draft's REAL reveal moment,
	// so a viewer never sees a Jackpot/HOF deduct before the slot lands — even
	// across a hard refresh, and even when drafts fill back-to-back. Only batch
	// drafts (not wheel-won specials) are recorded. Best-effort/cosmetic: this
	// never affects the actual VRF distribution.
	RecentFills           []RecentFill `json:"recentFills,omitempty" firestore:"RecentFills,omitempty"`
}

// RecentFill records when a batch draft filled, for reveal-time gating in the
// batch-progress UI. Id is the per-100 league number (== FilledLeaguesCount at
// fill); StartTime is the draft's DraftStartTime (Unix s) — reveal = StartTime-39.
type RecentFill struct {
	Id        int   `json:"id" firestore:"Id"`
	StartTime int64 `json:"startTime" firestore:"StartTime"`
}

type Score struct {
	DST        float64 `json:"DST"`
	QB         float64 `json:"QB"`
	RB         float64 `json:"RB"`
	RB2        float64 `json:"RB2"`
	TE         float64 `json:"TE"`
	WR         float64 `json:"WR"`
	WR2        float64 `json:"WR2"`
	GameStatus string  `json:"GameStatus"`
	Team       string  `json:"Team"`
}

type Scores struct {
	FantasyPoints []Score `json:"FantasyPoints"`
}

type ScoreObject struct {
	PlayerId                   string  `json:"playerId"`
	PrevWeekSeasonContribution float64 `json:"prevWeekSeasonContribution"`
	ScoreSeason                float64 `json:"scoreSeason"`
	ScoreWeek                  float64 `json:"scoreWeek"`
	IsUsedInCardScore          bool    `json:"isUsedInCardScore"`
	Team                       string  `json:"team"`
	Position                   string  `json:"position"`
}

type ScoreRoster struct {
	DST []ScoreObject `json:"DST"`
	QB  []ScoreObject `json:"QB"`
	RB  []ScoreObject `json:"RB"`
	TE  []ScoreObject `json:"TE"`
	WR  []ScoreObject `json:"WR"`
}

type CardScores struct {
	Card                DraftToken  `json:"card"`
	CardId              string      `json:"_cardId"`
	Roster              ScoreRoster `json:"roster"`
	ScoreWeek           float64     `json:"scoreWeek"`
	ScoreSeason         float64     `json:"scoreSeason"`
	PrevWeekSeasonScore float64     `json:"prevWeekSeasonScore"`
	OwnerId             string      `json:"ownerId"`
	Level               string      `json:"level"`
	PFP                 PfpInfo     `json:"pfp"`
}

func CreateLeague(ownerId string, draftNum int, draftType string) (*League, error) {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		fmt.Println("Error finding the chicago timezone or location")
		return nil, err
	}
	res := &League{
		LeagueId:     fmt.Sprintf(seasonYear+"-%s-draft-%d", draftType, draftNum),
		DisplayName:  fmt.Sprintf("BBB #%d", (draftNum)),
		CurrentUsers: make([]LeagueUser, 0),
		NumPlayers:   0,
		MaxPlayers:   10,
		StartDate:    time.Date(2024, time.September, 28, 0, 0, 0, 0, loc),
		EndDate:      time.Date(2024, time.December, 25, 0, 0, 0, 0, loc),
		DraftType:    draftType,
		Level:        "Pro",
		IsLocked:     false,
	}

	return res, nil
}

func JoinLeagues(ownerId string, numLeaguesToJoin int, draftType string, passType string) ([]DraftToken, error) {
	if time.Now().Unix() > int64(1092090938093) {
		err := fmt.Errorf("the deadline to join a BBB league has passed")
		return nil, err
	}

	data, err := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}

	// Pick the lowest-numbered passes of the type the user chose (free vs paid).
	// Honors the choice and never consumes the wrong type; errors clearly if the
	// wallet doesn't hold enough of that type.
	allTokens := make([]DraftToken, 0, len(data))
	for _, d := range data {
		var t DraftToken
		if err := d.DataTo(&t); err != nil {
			return nil, err
		}
		allTokens = append(allTokens, t)
	}
	selected, err := selectTokensByType(allTokens, passType, numLeaguesToJoin)
	if err != nil {
		return nil, err
	}

	// read document from db that tracks the amount of filled draft leagues there are for each type
	var counts DraftLeagueTracker
	err = utils.Db.ReadDocument("drafts", "draftTracker", &counts)
	if err != nil {
		fmt.Println("Error in reading the draft tracker document into objects")
		return nil, err
	}

	var currentDraft int
	if s := strings.ToLower(draftType); s == "fast" {
		currentDraft = counts.CurrentLiveDraftCount
	} else {
		currentDraft = counts.CurrentSlowDraftCount
	}

	res := make([]DraftToken, 0)

	for i := range selected {
		t := selected[i]
		if Environment == "prod" {
			cardNum, _ := strconv.ParseInt(t.CardId, 10, 64)
			contractOwner, _ := utils.Contract.GetOwnerOfToken(int(cardNum))
			if strings.ToLower(contractOwner) != strings.ToLower(t.OwnerId) {
				fmt.Println("This owner does not match the contract owner for ", t.CardId)
				return nil, fmt.Errorf("trying to add a card to a league that this owner does not have")
			}
		}
		currentDraft, err = AddCardToLeague(&t, currentDraft, draftType)
		if err != nil {
			return nil, err
		}
		res = append(res, t)
	}

	return res, nil
}

// scanForPartialLeague walks backwards from startFrom looking for the lowest-numbered
// league with 1-9 players that this owner is not already a member of. The per-type
// draft counter (CurrentLiveDraftCount / CurrentSlowDraftCount) can drift ahead of
// reality when league creations and fills desync (e.g. fill-bots paths), which leaves
// partially-filled leagues stranded between the counter and the most recent create.
// When that happens, a plain forward scan from the counter misses them entirely and
// every new join creates its own empty league — two users never land together.
//
// Returns 0 if no eligible partial league is found within the lookback window; the
// caller should then fall back to the counter-based forward iteration below.
func scanForPartialLeague(startFrom int, draftType string, ownerId string) int {
	const maxLookback = 30
	start := time.Now()
	read := func(n int) (*League, bool) {
		var l League
		draftId := fmt.Sprintf(seasonYear+"-%s-draft-%d", draftType, n)
		if err := utils.Db.ReadDocument("drafts", draftId, &l); err != nil {
			return nil, false
		}
		return &l, true
	}
	lowest := selectLowestPartialLeague(startFrom, maxLookback, ownerId, read)
	fmt.Printf("[join-timing] scanForPartialLeague startFrom=%d type=%s owner=%s -> %d in %v\n",
		startFrom, draftType, ownerId, lowest, time.Since(start))
	return lowest
}

func AddCardToLeague(token *DraftToken, expectedDraftNum int, draftType string) (int, error) {
	// Prefer joining the oldest partially-filled league this owner isn't in, so
	// drafts fill rather than scatter. Fall back to the counter's starting point
	// only if no partial league exists within the lookback window. The inner
	// transaction below still handles the race where two callers target the
	// same league — whoever lands second sees the updated NumPlayers and
	// either appends or bumps to the next league.
	currentDraftNum := expectedDraftNum
	if partial := scanForPartialLeague(expectedDraftNum, draftType, token.OwnerId); partial > 0 {
		currentDraftNum = partial
	}
	var draftId string
	var l League

	// The owner's spendable-pass doc. We CLAIM (delete) it INSIDE the seat
	// transaction below, atomic with the seat, so two concurrent joins can't
	// put the same pass into two leagues (the double-spend). Same ref every
	// loop iteration — the pass doesn't change, only which league we try.
	validTokenRef := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", token.OwnerId)).Doc(token.CardId)

	// find the right league to add the card to ensuring that this owner does not already have a token in that league
	for {
		draftId = fmt.Sprintf(seasonYear+"-%s-draft-%d", draftType, currentDraftNum)
		err := utils.Db.ReadDocument("drafts", draftId, &l)
		if err != nil {
			s := err.Error()
			if res := strings.Contains(s, "code = NotFound"); res {
				league, err := CreateLeague(token.OwnerId, currentDraftNum, draftType)
				if err != nil {
					return -1, err
				}
				l = *league
				err = utils.Db.CreateOrUpdateDocument("drafts", l.LeagueId, &league)
				if err != nil {
					return -1, err
				}
			} else {
				return -1, err
			}
		}

		leagueRef := utils.Db.Client.Collection("drafts").Doc(l.LeagueId)
		fmt.Println(leagueRef)
		err = utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
			doc, err := tx.Get(leagueRef) // tx.Get, NOT ref.Get!
			if err != nil {
				return err
			}

			var league League
			err = doc.DataTo(&league)
			if err != nil {
				return err
			}
			fmt.Println("league inside of tx: ", league)

			// Belt-and-suspenders: a regular join must never land in a wheel-won
			// special (JP/HOF). Roll to the next slot — the loop continues on this
			// error string (Richard, 2026-06-18).
			if league.Level == "Jackpot" || league.Level == "Hall of Fame" {
				return fmt.Errorf("try the next leagueId")
			}
			if league.NumPlayers == 10 {
				fmt.Printf("%s is now locked so we are returning an error string to trigger the for loop to continue\r", league.LeagueId)
				return fmt.Errorf("try the next leagueId")
			}
			isValid := true
			for j := 0; j < len(league.CurrentUsers); j++ {
				if league.CurrentUsers[j].OwnerId == token.OwnerId {
					isValid = false
				}
			}
			if !isValid {
				fmt.Printf("%s is already in %s so we are continuing", token.OwnerId, league.LeagueId)
				return fmt.Errorf("try the next leagueId")
			}

			// Atomic pass-claim: confirm the pass is still in the owner's
			// spendable pool, then seat the user AND consume the pass in the
			// SAME commit. If a concurrent join already took it, this read is
			// NotFound -> abort with a DISTINCT error ("pass already used", not
			// "try the next leagueId") so the join stops instead of re-trying
			// another league with a pass that's already gone. (All reads in a
			// Firestore tx must precede all writes — this read is still before
			// the tx.Set/tx.Delete below, so the ordering is valid.)
			if _, terr := tx.Get(validTokenRef); terr != nil {
				if strings.Contains(terr.Error(), "code = NotFound") {
					return fmt.Errorf("pass already used")
				}
				return terr
			}

			league.CurrentUsers = append(league.CurrentUsers, LeagueUser{OwnerId: token.OwnerId, TokenId: token.CardId})
			league.NumPlayers++
			l = league
			if err := tx.Set(leagueRef, &league); err != nil {
				return err
			}
			return tx.Delete(validTokenRef)
		})
		if err != nil {
			if err.Error() != "try the next leagueId" {
				return -1, err
			}
		} else {
			break
		}
		currentDraftNum++
	}

	token.LeagueId = l.LeagueId
	token.DraftType = draftType
	token.LeagueDisplayName = l.DisplayName

	// Early count ping for the non-fill case, BEFORE the cleanup writes, so
	// observers' lobbies update within ~100ms instead of after the two
	// Firestore cleanup writes complete. Best-effort: the 2.5s poll reconciles
	// the count if this fails, and we must not return early here or we'd skip
	// the double-spend cleanup below. (The fill case writes numPlayers:10 in
	// its own branch.)
	if l.NumPlayers < 10 {
		ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", l.LeagueId))
		if err := ref.Set(context.TODO(), map[string]interface{}{"numPlayers": l.NumPlayers}); err != nil {
			fmt.Println("WARN: failed early numPlayers ping to RTDB on join (poll will reconcile): ", err)
		}
	}

	// The pass was already removed from validDraftTokens INSIDE the seat
	// transaction above (atomic with the seat — see the tx.Delete). Here we
	// only write the denormalized "in use" copies (usedDraftTokens / cards /
	// metadata). If this best-effort write fails, the pass is still correctly
	// consumed + seated, so it can never be re-used; the copies reconcile.
	if err := token.updateInUseDraftTokenInDatabase(draftId); err != nil {
		return -1, err
	}

	if l.NumPlayers == 10 {
		// Write numPlayers:10 to RTDB BEFORE CreateLeagueDraftStateUponFilling
		// so the Firebase Function onDraftFilled fires at fill-time, not at
		// draft-start. The function reads the roster from Firestore — humans
		// in `drafts/{draftId}.CurrentUsers` are already committed by the
		// time we get here, so the fallback path in onDraftFilled returns
		// the right wallets. The later realTimeDraftInfoRef.Update in
		// draft-actions.go:48 also writes numPlayers:10, but that's a
		// no-op for the trigger (before>=10 && after>=10 → bails).
		// randomizeStartAt is a SHARED anchor (epoch ms) written at fill-time so
		// every client's "randomizing" bar runs on the same clock and reveals
		// together — including the 10th joiner, who reads the same value and
		// snaps to the right elapsed position. Written alongside numPlayers:10
		// in one atomic Update, BEFORE CreateLeagueDraftStateUponFilling, so the
		// bar can start covering the (now-parallelized) backend work immediately.
		// Frontend only READS it; downstream reveal + 15s/60s countdowns are
		// unchanged (still anchored to the server draftStartTime).
		randomizeStartAt := time.Now().UnixMilli()
		ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", l.LeagueId))
		if err := ref.Update(context.TODO(), map[string]interface{}{"numPlayers": 10, "randomizeStartAt": randomizeStartAt}); err != nil {
			fmt.Println("WARN: failed to write numPlayers:10 + randomizeStartAt to RTDB at fill-time (notification/bar-sync will lag): ", err)
			// Non-fatal — the draft-start path will still set numPlayers:10
			// and the bar falls back to a local anchor.
		} else {
			fmt.Printf("[fill-timing] wrote numPlayers:10 + randomizeStartAt:%d to RTDB for %s\n", randomizeStartAt, l.LeagueId)
		}
		err := CreateLeagueDraftStateUponFilling(draftId, draftType)
		if err != nil {
			fmt.Println("error creating draft state upon league filling: ", err)
			RemoveUserFromDraftWithRTBUpdate(token.CardId, token.OwnerId, l.LeagueId, false)
			fmt.Printf("Removed user from draft after it failed to complete the draft state for %v with error: %v", token, err)
			return -1, err
		}
	}

	// Hand the post-join count back to the caller so the draft-room frontend
	// can render the right number on first paint instead of waiting on RTDB
	// or the 2.5s poll. l.NumPlayers reflects the count AFTER this token was
	// added (incremented inside the transaction above).
	token.NumPlayers = l.NumPlayers

	return currentDraftNum, nil
}

func RemoveUserFromDraftWithRTBUpdate(tokenId, ownerId, draftId string, withRTBUpdate bool) (bool, error) {
	var l League

	leagueRef := utils.Db.Client.Collection("drafts").Doc(draftId)
	err := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(leagueRef)
		if err != nil {
			return err
		}

		var league League
		if err := doc.DataTo(&league); err != nil {
			return err
		}

		if league.NumPlayers == 10 {
			fmt.Printf("%s is now locked so we are returning an error string to trigger the for loop to continue\r", l.LeagueId)
			return fmt.Errorf("you cannot leave this draft as it already has 10 members")
		}

		// Special wheel-won drafts (Jackpot/HOF level assigned BEFORE fill) have
		// locked seats: the only exit is selling the pass on the marketplace,
		// which transfers the seat via the swap endpoint — never via leave.
		// Normal drafts only receive a Level at fill (10/10), where the check
		// above already blocks leaving, so this only ever matches special drafts.
		if league.Level == "Jackpot" || league.Level == "Hall of Fame" {
			return fmt.Errorf("seats in a special %s draft are locked — sell the pass on the marketplace instead", league.Level)
		}

		isInLeague := false
		newCurrentUsers := make([]LeagueUser, 0)
		fmt.Printf("Requested Ownerid: %s, requested tokenId: %s\r", ownerId, tokenId)
		fmt.Printf("League Data: %v", league)
		for i := 0; i < len(league.CurrentUsers); i++ {
			fmt.Printf("OwnerId: %s, TokenId: %s\r", league.CurrentUsers[i].OwnerId, league.CurrentUsers[i].TokenId)
			if league.CurrentUsers[i].OwnerId == ownerId && league.CurrentUsers[i].TokenId == tokenId {
				isInLeague = true
			} else {
				newCurrentUsers = append(newCurrentUsers, league.CurrentUsers[i])
			}
		}
		if !isInLeague {
			return fmt.Errorf("this user was not found to be in the current User array of the draft league")
		}

		league.CurrentUsers = newCurrentUsers
		league.NumPlayers--
		l = league
		return tx.Set(leagueRef, &league)
	})
	if err != nil {
		return false, err
	}

	var token DraftToken
	err = utils.Db.ReadDocument("draftTokens", tokenId, &token)
	if err != nil {
		return false, err
	}

	err = token.RemoveTokenFromLeague()
	if err != nil {
		return false, err
	}

	if withRTBUpdate {
		ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", l.LeagueId))
		if err := ref.Set(context.TODO(), map[string]interface{}{"numPlayers": l.NumPlayers}); err != nil {
			fmt.Println("Error in updating real time database when player leaves draft: ", err)
			return false, err
		}
	}

	return true, nil
}

func GetCardFromLeagueAndOwner(draftId, ownerId string) (*DraftToken, error) {
	var league League

	err := utils.Db.ReadDocument("drafts", draftId, &league)
	if err != nil {
		fmt.Println("ERROR reading draft document: ", err)
		return nil, err
	}

	tokenId := ""
	for i := 0; i < len(league.CurrentUsers); i++ {
		obj := league.CurrentUsers[i]
		if strings.EqualFold(obj.OwnerId, ownerId) {
			tokenId = obj.TokenId
		}
	}

	if tokenId == "" {
		fmt.Println("could not find this user in the leagues current users so we are returning")
		return nil, fmt.Errorf("could not find this user in the leagues current users so we are returning")
	}

	var token DraftToken
	err = utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/cards", strings.ToLower(draftId)), tokenId, &token)
	if err != nil {
		fmt.Println("ERROR reading token from inside of league: ", err)
		return nil, err
	}

	return &token, nil

}

func ReturnNumberOfFilledLeagues() (int, error) {
	var draftTracker DraftLeagueTracker
	err := utils.Db.ReadDocument("drafts", "draftTracker", &draftTracker)
	if err != nil {
		fmt.Println("ERROR in reading draft Tracker: ", err)
		return -1, err
	}

	return (draftTracker.FilledLeaguesCount - 1), nil
}

type AllDraftTokensLeaderborad struct {
	Leaderboard  []CardScores `json:"leaderboard"`
	OwnersTokens []CardScores `json:"ownersTokens"`
}

func ReturnAllDraftTokenLeaderboard(gameweek, orderBy, ownerId, level string) (AllDraftTokensLeaderborad, error) {
	if gameweek == "" || orderBy == "" {
		fmt.Println("either the gameweek or order by was an empty string")
		return AllDraftTokensLeaderborad{}, fmt.Errorf("either the gameweek or order by was an empty string")
	}
	leaderboard := make([]CardScores, 0)
	ownersTokens := make([]CardScores, 0)

	//data, err := utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).Documents(context.Background()).GetAll()
	var data []*firestore.DocumentSnapshot
	var err error
	if level != "Pro" {
		data, err = utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).Where("Level", "==", level).OrderBy(orderBy, firestore.Direction(1)).Documents(context.Background()).GetAll()
		if err != nil {
			fmt.Println("ERROR reading all draft token card scores in the draftTokenLeaderboard collection: ", err)
			return AllDraftTokensLeaderborad{}, err
		}
	} else {
		data, err = utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).OrderBy(orderBy, firestore.Direction(1)).Documents(context.Background()).GetAll()
		if err != nil {
			fmt.Println("ERROR reading all draft token card scores in the draftTokenLeaderboard collection: ", err)
			return AllDraftTokensLeaderborad{}, err
		}
	}

	for i := (len(data) - 1); i >= 0; i-- {
		var tokenScore CardScores
		err = data[i].DataTo(&tokenScore)
		if err != nil {
			fmt.Println("Error reading token score data from snapshot into data object: ", err)
			return AllDraftTokensLeaderborad{}, err
		}

		//leaderboard[99-i] = tokenScore
		leaderboard = append(leaderboard, tokenScore)

		if strings.EqualFold(tokenScore.OwnerId, ownerId) {
			fmt.Println("Found a token for this user")
			ownersTokens = append(ownersTokens, tokenScore)
		}
	}

	return AllDraftTokensLeaderborad{Leaderboard: leaderboard, OwnersTokens: ownersTokens}, nil
}

func ReturnDraftLeagueLeaderboard(gameweek, ownerId, draftId, orderBy string) (AllDraftTokensLeaderborad, error) {
	if gameweek == "" || ownerId == "" || draftId == "" || orderBy == "" {
		fmt.Println("either the gameweek, ownerId, or draftid was an empty string")
		return AllDraftTokensLeaderborad{}, fmt.Errorf("either the gameweek, ownerId, or draftid was an empty string")
	}
	leaderboard := make([]CardScores, 0)
	ownersTokens := make([]CardScores, 0)

	//data, err := utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).Documents(context.Background()).GetAll()
	data, err := utils.Db.Client.Collection(fmt.Sprintf("drafts/%s/scores/%s/cards", draftId, gameweek)).OrderBy(orderBy, firestore.Direction(1)).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("ERROR reading all draft token card scores in the draftTokenLeaderboard collection: ", err)
		return AllDraftTokensLeaderborad{}, err
	}
	fmt.Println("Length of response: ", len(data))

	for i := len(data) - 1; i >= 0; i-- {
		var tokenScore CardScores
		err = data[i].DataTo(&tokenScore)
		if err != nil {
			fmt.Println("Error reading token score data from snapshot into data object: ", err)
			return AllDraftTokensLeaderborad{}, err
		}
		fmt.Println("Token: ", tokenScore)
		//leaderboard[9-i] = tokenScore
		leaderboard = append(leaderboard, tokenScore)
		if strings.EqualFold(tokenScore.OwnerId, ownerId) {
			fmt.Println("Found a token for this user")
			ownersTokens = append(ownersTokens, tokenScore)
		}

		fmt.Println("CardScore: ", tokenScore)
	}

	return AllDraftTokensLeaderborad{Leaderboard: leaderboard, OwnersTokens: ownersTokens}, nil
}

func GetHallOfFameRegularSeasonWinners() (map[string]*CardScores, error) {
	hofCardsMap := make(map[string]*CardScores, 0)
	data, err := utils.Db.Client.Collection("2024DraftPlayoffData/HOFLeagueWinners/cards").Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("Error reading hall of fame league winners: ", err)
		return nil, err
	}

	fmt.Println("Data returned from hof winners: ", len(data))
	for i := 0; i < len(data); i++ {
		var card CardScores
		err = data[i].DataTo(&card)
		if err != nil {
			return nil, err
		}

		hofCardsMap[card.CardId] = &card
	}

	return hofCardsMap, nil
}

func ReturnHallOfFamePlayoffLeaderboard(gameweek, orderBy, ownerId string) (AllDraftTokensLeaderborad, error) {
	// data, err := utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).Where("Level", "==", "Hall of Fame").OrderBy(orderBy, firestore.Direction(1)).Documents(context.Background()).GetAll()
	// if err != nil {
	// 	fmt.Println("ERROR reading all draft token card scores in the draftTokenLeaderboard collection: ", err)
	// 	return AllDraftTokensLeaderborad{}, err
	// }

	data, err := utils.Db.Client.Collection(fmt.Sprintf("draftTokenLeaderboard/%s/cards", gameweek)).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Println("ERROR reading all draft token card scores in the draftTokenLeaderboard collection: ", err)
		return AllDraftTokensLeaderborad{}, err
	}

	hofCards, err := GetHallOfFameRegularSeasonWinners()
	if err != nil {
		return AllDraftTokensLeaderborad{}, err
	}
	fmt.Println("Number of hof cards in playoff: ", len(hofCards))
	hofPlayoffCards := make([]CardScores, 0)
	ownersCards := make([]CardScores, 0)

	for i := 0; i < len(data); i++ {
		var card CardScores
		err = data[i].DataTo(&card)
		if err != nil {
			return AllDraftTokensLeaderborad{}, err
		}

		if _, ok := hofCards[card.CardId]; ok {
			hofPlayoffCards = append(hofPlayoffCards, card)
			if strings.EqualFold(ownerId, card.OwnerId) {
				ownersCards = append(ownersCards, card)
			}
		}
	}

	for j := 0; j < len(hofPlayoffCards)-1; j++ {
		for z := 1 + j; z < len(hofPlayoffCards); z++ {
			if hofPlayoffCards[j].ScoreSeason < hofPlayoffCards[z].ScoreSeason {
				intermediate := hofPlayoffCards[j]
				hofPlayoffCards[j] = hofPlayoffCards[z]
				hofPlayoffCards[z] = intermediate
			}
		}
	}

	fmt.Println("Num of tokens returned in leaderboard: ", len(hofPlayoffCards))

	return AllDraftTokensLeaderborad{Leaderboard: hofPlayoffCards, OwnersTokens: ownersCards}, nil
}

type BatchProgressResponse struct {
	Current            int `json:"current"`
	Total              int `json:"total"`
	JackpotRemaining   int `json:"jackpotRemaining"`
	HofRemaining       int `json:"hofRemaining"`
	FilledLeaguesCount int `json:"filledLeaguesCount"`
}

func ReturnBatchProgress() (*BatchProgressResponse, error) {
	var draftTracker DraftLeagueTracker
	err := utils.Db.ReadDocument("drafts", "draftTracker", &draftTracker)
	if err != nil {
		fmt.Println("ERROR in reading draft Tracker: ", err)
		return nil, err
	}

	current := draftTracker.FilledLeaguesCount % 100
	// Batch starts at the most recent multiple of 100. At an exact batch
	// boundary (filled%100==0 and filled>0), drafts haven't yet started
	// filling into the next batch — the just-completed batch is still the
	// one whose progress we want to display ("100/100 done"), so anchor
	// counting on its start rather than the next batch's start.
	batchStart := draftTracker.FilledLeaguesCount - current
	if current == 0 && draftTracker.FilledLeaguesCount > 0 {
		batchStart = draftTracker.FilledLeaguesCount - 100
	}

	// Count jackpots ALREADY HIT in the current batch.
	// With VRF the full batch's JP/HOF IDs are pre-determined and stored
	// in the tracker at batch start — so we filter not just "in this
	// batch" (id > batchStart) but also "already filled" (id <=
	// FilledLeaguesCount). Otherwise the header would show 0 remaining
	// the moment a new batch starts, before any draft has hit.
	jackpotsAlreadyHit := 0
	for _, id := range draftTracker.JackpotLeagueIds {
		if id > batchStart && id <= draftTracker.FilledLeaguesCount {
			jackpotsAlreadyHit++
		}
	}
	jackpotRemaining := 1 - jackpotsAlreadyHit
	if jackpotRemaining < 0 {
		jackpotRemaining = 0
	}

	hofsAlreadyHit := 0
	for _, id := range draftTracker.HofLeagueIds {
		if id > batchStart && id <= draftTracker.FilledLeaguesCount {
			hofsAlreadyHit++
		}
	}
	hofRemaining := 5 - hofsAlreadyHit
	if hofRemaining < 0 {
		hofRemaining = 0
	}

	return &BatchProgressResponse{
		Current:            current,
		Total:              100,
		JackpotRemaining:   jackpotRemaining,
		HofRemaining:       hofRemaining,
		FilledLeaguesCount: draftTracker.FilledLeaguesCount,
	}, nil
}
