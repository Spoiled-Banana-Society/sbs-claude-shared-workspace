package models

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type Prizes struct {
	ETH float64 `json:"ETH"`
}

var Environment = os.Getenv("ENVIRONMENT")

type DraftToken struct {
	Roster            *TokenRoster `json:"roster"`
	DraftType         string       `json:"_draftType"`
	CardId            string       `json:"_cardId"`
	ImageUrl          string       `json:"_imageUrl"`
	Level             string       `json:"_level"`
	OwnerId           string       `json:"_ownerId"`
	LeagueId          string       `json:"_leagueId"`
	LeagueDisplayName string       `json:"_leagueDisplayName"`
	Rank              string       `json:"_rank"`
	LeagueRank        string       `json:"_leagueRank"`
	WeekScore         string       `json:"_weekScore"`
	SeasonScore       string       `json:"_seasonScore"`
	Prizes            Prizes       `json:"prizes"`
	// NumPlayers is populated by AddCardToLeague on a successful join with
	// the post-join player count of the league the token landed in, so the
	// frontend can show the right number on the very first paint without
	// waiting for an RTDB push or the 2.5s poll. Zero/absent on other
	// endpoints — those don't have a meaningful per-token player count.
	// (Restored 2026-05-28: lost in the rev-00124→00130 deploy that shipped
	// the fill-time notification change from a branch missing this field.)
	NumPlayers int `json:"numPlayers,omitempty" firestore:"-"`
	// PassType is 'paid' or 'free' — the source of truth for which kind of
	// draft pass this token is. Set at mint time (free = wheel/admin grant,
	// paid = purchase). Drives: which pool the user's chosen pass type draws
	// from at entry, which counter a refund returns to, and promo eligibility
	// (free-pass drafts earn NO promo credit). Defaults to 'paid' when unset
	// (legacy tokens are backfilled from pass_origin).
	PassType string `json:"passType,omitempty"`
	// RealTokenId preserves the true on-chain BBB4 tokenId in the case where
	// the spendable token had to be registered under a synthetic CardId. That
	// happens when the on-chain id collides with a stale global draftTokens row
	// owned by a *different* wallet (e.g. a number reused across a contract
	// redeploy). CardId then holds a unique synthetic id (so the keyspace never
	// blocks a legitimate owner) while RealTokenId keeps the on-chain link.
	// Empty when CardId already equals the on-chain id (the common case).
	RealTokenId string `json:"realTokenId,omitempty"`
}

type UsersTokens struct {
	Available []DraftToken `json:"available"`
	Active    []DraftToken `json:"active"`
}

func ReturnAllDraftTokensForOwner(ownerId string) (*UsersTokens, error) {
	res := &UsersTokens{
		Available: make([]DraftToken, 0),
		Active:    make([]DraftToken, 0),
	}

	data, err := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}

	for i := 0; i < len(data); i++ {
		var token DraftToken
		data[i].DataTo(&token)
		tokenNum, err := strconv.Atoi(token.CardId)
		if err != nil {
			// Legacy tokens from the deprecated /staging/mint-tokens endpoint have
			// non-numeric ids like "staging-1771912537015-4". They have no real
			// NFT backing — skip them instead of returning 500 for the whole list.
			fmt.Printf("draftToken/all: skipping non-numeric CardId %q for owner %s\n", token.CardId, ownerId)
			continue
		}
		res.Available = append(res.Available, token)

		// ISSUE this check is brekaing for users with multiple tokens with contract returning no owner
		// TODO re-implement with more stable web3 connection

		if Environment == "no-entry" {
			res, _ := utils.Contract.GetOwnerOfToken(tokenNum)
			if strings.ToLower(token.OwnerId) != strings.ToLower(res) {
				fmt.Println(res)
				fmt.Println(token.OwnerId)
				return nil, fmt.Errorf("the passed in ownerId does not match the ownerId returned from the smart contract for token %s: expected owner(%s) / actual owner(%s)", token.CardId, ownerId, res)
			}

			if strings.ToLower(res) == strings.ToLower(token.OwnerId) {
				fmt.Println("These owners are EQUAL AND WE ARE WORKING")
			} else {
				fmt.Println("THESE ARE NOT MSTCHING")
			}
		}
	}

	data, err = utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}

	for i := 0; i < len(data); i++ {
		var token DraftToken
		data[i].DataTo(&token)
		// Backfill display name from the draft doc when the cached
		// LeagueDisplayName on the token is empty. Covers the race
		// window between user joining a lobby and the fill-flow loop
		// writing leagueDisplayName onto each user's token. Without
		// this, the frontend falls back to extracting digits from the
		// slot id ('2024-fast-draft-804' → 804) instead of the actual
		// league number ('BBB #805'), and the row label is wrong by 1.
		if token.LeagueDisplayName == "" && token.LeagueId != "" {
			var league DraftInfo
			if err := utils.Db.ReadDocument("drafts", token.LeagueId, &league); err == nil && league.DisplayName != "" {
				token.LeagueDisplayName = league.DisplayName
			}
		}
		res.Active = append(res.Active, token)
	}

	return res, nil
}

// queueMembershipCache caches the parsed v2_queues rounds (jackpot/hof/
// jackhof) so the active-token variant can resolve a wallet's special-draft
// seats with zero extra Firestore reads on the hot path (3 doc reads per
// instance per minute, total). Queue drafts live under PRIOR-SEASON ids on
// purpose (lane-numbering isolation), which is exactly why a plain season
// filter must never be the only source of "active" (2026-09-02 regression:
// wheel-draft rows starved — AceJohn report).
var queueMembershipCache struct {
	mu      sync.Mutex
	rounds  []queueRoundLite
	fetched time.Time
}

type queueRoundLite struct {
	draftId string
	wallets map[string]bool
}

func queueDraftIdsForWallet(ownerId string) []string {
	queueMembershipCache.mu.Lock()
	defer queueMembershipCache.mu.Unlock()

	if time.Since(queueMembershipCache.fetched) > 60*time.Second {
		rounds := make([]queueRoundLite, 0)
		for _, qt := range []string{"jackpot", "hof", "jackhof"} {
			snap, err := utils.Db.Client.Collection("v2_queues").Doc(qt).Get(context.Background())
			if err != nil {
				// Fail SOFT: keep whatever we had; an empty cache just means the
				// caller returns season tokens only for this cycle.
				continue
			}
			raw, _ := snap.Data()["rounds"].([]interface{})
			for _, r := range raw {
				rm, ok := r.(map[string]interface{})
				if !ok {
					continue
				}
				draftId, _ := rm["draftId"].(string)
				if draftId == "" {
					continue
				}
				lite := queueRoundLite{draftId: draftId, wallets: map[string]bool{}}
				members, _ := rm["members"].([]interface{})
				for _, m := range members {
					mm, ok := m.(map[string]interface{})
					if !ok {
						continue
					}
					if w, _ := mm["wallet"].(string); w != "" {
						lite.wallets[strings.ToLower(w)] = true
					}
				}
				rounds = append(rounds, lite)
			}
		}
		if len(rounds) > 0 {
			queueMembershipCache.rounds = rounds
			queueMembershipCache.fetched = time.Now()
		}
	}

	w := strings.ToLower(ownerId)
	ids := make([]string, 0, 2)
	for _, r := range queueMembershipCache.rounds {
		if r.wallets[w] {
			ids = append(ids, r.draftId)
		}
	}
	return ids
}

// ReturnActiveDraftTokensForOwner is the cost-scoped variant behind
// /draftToken/all?active=1 (cost audit 2026-09-02, made queue-aware 09-03).
// The My Drafts page polls the token list every 5s per user, and the full
// endpoint reads the owner's ENTIRE validDraftTokens + usedDraftTokens
// history on every call — hundreds of Firestore doc reads per poll for
// veteran wallets (the largest single line item in the August Firestore
// bill). That poll only needs (a) CURRENT-SEASON seats and (b) the wallet's
// special queue/wheel seats, which live under prior-season ids by design.
// (a) is one season-range query; (b) resolves via the cached v2_queues
// membership (zero hot-path reads) plus one tiny equality query per queue
// draft the wallet is actually in (typically 0-2). Available stays an empty
// array. Callers without ?active=1 are completely untouched.
func ReturnActiveDraftTokensForOwner(ownerId string) (*UsersTokens, error) {
	res := &UsersTokens{
		Available: make([]DraftToken, 0),
		Active:    make([]DraftToken, 0),
	}

	appendToken := func(doc *firestore.DocumentSnapshot, seen map[string]bool) {
		var token DraftToken
		doc.DataTo(&token)
		if seen[token.CardId] {
			return
		}
		seen[token.CardId] = true
		// Same display-name backfill as ReturnAllDraftTokensForOwner above —
		// covers the race window between joining a lobby and the fill-flow
		// loop writing leagueDisplayName onto each user's token.
		if token.LeagueDisplayName == "" && token.LeagueId != "" {
			var league DraftInfo
			if err := utils.Db.ReadDocument("drafts", token.LeagueId, &league); err == nil && league.DisplayName != "" {
				token.LeagueDisplayName = league.DisplayName
			}
		}
		res.Active = append(res.Active, token)
	}
	seen := make(map[string]bool)

	// (a) current-season seats.
	seasonLo := fmt.Sprintf("%d-", time.Now().Year())
	seasonHi := fmt.Sprintf("%d-", time.Now().Year()+1)
	data, err := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).
		Where("LeagueId", ">=", seasonLo).
		Where("LeagueId", "<", seasonHi).
		Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}
	for i := 0; i < len(data); i++ {
		appendToken(data[i], seen)
	}

	// (b) special queue/wheel seats (prior-season ids). Best-effort: an error
	// here must never take down the whole list — season tokens still return.
	for _, qid := range queueDraftIdsForWallet(ownerId) {
		qdata, qerr := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/usedDraftTokens", ownerId)).
			Where("LeagueId", "==", qid).
			Documents(context.Background()).GetAll()
		if qerr != nil {
			continue
		}
		for i := 0; i < len(qdata); i++ {
			appendToken(qdata[i], seen)
		}
	}

	return res, nil
}

type Metadata struct {
	Description string                `json:"description"`
	Name        string                `json:"name"`
	Image       string                `json:"image"`
	Attributes  []Attributetrait_type `json:"attributes"`
}

type Attributetrait_type struct {
	Trait_Type string `json:"trait_type"`
	Value      string `json:"value"`
}

// generateUniqueTokenId returns a numeric-string id guaranteed not to collide
// with an existing global draftTokens row. It MUST be numeric because
// ReturnAllDraftTokensForOwner skips non-numeric CardIds (so a non-numeric id
// would never be spendable). Uses a nanosecond timestamp base — astronomically
// far above real on-chain ids and other synthetic ids — plus an existence-check
// loop as belt-and-suspenders against the (vanishingly small) chance of a clash.
func generateUniqueTokenId() string {
	base := time.Now().UnixNano()
	for i := int64(0); i < 1000; i++ {
		candidate := strconv.FormatInt(base+i, 10)
		var existing DraftToken
		if err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), candidate, &existing); err != nil {
			// ReadDocument errors when the doc does not exist → id is free.
			return candidate
		}
	}
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

// findOwnerTokenByRealTokenId returns this owner's already-registered spendable
// token for a given on-chain (real) token id, if one exists. This makes
// registration idempotent for recycled ids that go through the collision path:
// the mint route and the Alchemy reconcile webhook can both fire for the same
// mint, and without this they would each create a separate synthetic record →
// duplicate passes for one on-chain NFT.
func findOwnerTokenByRealTokenId(ownerId, realTokenId string) (*DraftToken, bool) {
	if realTokenId == "" {
		return nil, false
	}
	path := fmt.Sprintf("owners/%s/validDraftTokens", strings.ToLower(ownerId))
	docs, err := utils.Db.Client.Collection(path).Where("RealTokenId", "==", realTokenId).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Printf("findOwnerTokenByRealTokenId: query error owner=%s realTokenId=%s: %v\n", ownerId, realTokenId, err)
		return nil, false
	}
	if len(docs) == 0 {
		return nil, false
	}
	var t DraftToken
	if err := docs[0].DataTo(&t); err != nil {
		return nil, false
	}
	return &t, true
}

// allDigits reports whether s is a non-empty run of ASCII digits.
func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// decodeOnchainTokenId resolves the on-chain BBB4 token id from a stored record.
// realTokenId when set; otherwise the cardId is either the bare on-chain id
// (<=7 digits) or the staging form <10-digit unix-seconds><tokenId>.
func decodeOnchainTokenId(cardId, realTokenId string) string {
	if rt := strings.TrimSpace(realTokenId); allDigits(rt) {
		return rt
	}
	c := strings.TrimSpace(cardId)
	if allDigits(c) {
		if len(c) <= 7 {
			return c
		}
		if len(c) >= 11 && len(c) <= 17 {
			return c[10:]
		}
	}
	return ""
}

// findOwnerUsedTokenByOnchainId returns the owner's USED (drafted) record for a
// given on-chain id, matching across the differing cardId schemes. Used to stop
// registration from re-adding an already-drafted token to the spendable pool.
func findOwnerUsedTokenByOnchainId(ownerId, onchainId string) (*DraftToken, bool) {
	if onchainId == "" {
		return nil, false
	}
	path := fmt.Sprintf("owners/%s/usedDraftTokens", strings.ToLower(ownerId))
	docs, err := utils.Db.Client.Collection(path).Documents(context.Background()).GetAll()
	if err != nil {
		fmt.Printf("findOwnerUsedTokenByOnchainId: query error owner=%s onchainId=%s: %v\n", ownerId, onchainId, err)
		return nil, false
	}
	for _, d := range docs {
		var t DraftToken
		if err := d.DataTo(&t); err != nil {
			continue
		}
		if decodeOnchainTokenId(t.CardId, t.RealTokenId) == onchainId {
			return &t, true
		}
	}
	return nil, false
}

func MintDraftTokenInDb(tokenId, ownerId, passType string) (*DraftToken, error) {
	// Normalize: only 'free' is special; anything else (incl. empty/legacy) is paid.
	if passType != "free" {
		passType = "paid"
	}
	cardNum, _ := strconv.ParseInt(tokenId, 10, 64)
	if Environment == "prod" {
		fmt.Println("Inside of prod")
		contractOwner, _ := utils.Contract.GetOwnerOfToken(int(cardNum))
		if strings.ToLower(contractOwner) != strings.ToLower(ownerId) {
			fmt.Println("This owner does not match the contract owner for ", tokenId)
			return nil, fmt.Errorf("trying to mint a card to a person who does not own it on the smart contract")
		}
		if ownerId == "" || tokenId == "" {
			fmt.Println("ERROR: an empty owner or token id was passed into mintDraftTOken")
			return nil, fmt.Errorf("error an empty owner or token id was passed into MintDraftToken")
		}
	}

	// GUARD (critical): if this owner has ALREADY DRAFTED this on-chain token
	// (it lives in usedDraftTokens), do NOT re-register it as a spendable pass —
	// a used pass must never return to the pool. Catches bulk reconciles /
	// backfills that re-register on-chain-owned tokens, including drafted teams
	// the owner still holds on-chain (BBB4 isn't burned on draft). The legit
	// "leave a draft -> get your pass back" path goes through RemoveTokenFromLeague
	// (which REMOVES from usedDraftTokens), so it is unaffected by this check.
	if used, found := findOwnerUsedTokenByOnchainId(ownerId, tokenId); found {
		fmt.Printf("MintDraftTokenInDb: on-chain id %s already DRAFTED for %s (usedDraftTokens cardId %s) — refusing to re-add as a pass\n", tokenId, ownerId, used.CardId)
		return used, nil
	}

	// Resolve the id this spendable token will be stored under. Normally that
	// is the on-chain tokenId. If a row already exists for that id we must NOT
	// blindly 500 (the old behavior) — that silently dropped legitimately-owned
	// tokens and let the user-facing counter drift above real inventory.
	realTokenId := ""
	var oldToken DraftToken
	err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), tokenId, &oldToken)
	if err == nil {
		if strings.EqualFold(oldToken.OwnerId, ownerId) {
			// Same owner already holds this exact token (available OR already in
			// a league). Re-registering would double-credit them. Idempotent:
			// return the existing record without writing a duplicate.
			fmt.Printf("MintDraftTokenInDb: tokenId %s already owned by %s — idempotent skip\r", tokenId, ownerId)
			return &oldToken, nil
		}
		// Cross-owner id collision: a stale row holds this number for a
		// different wallet (typically a tokenId reused across a contract
		// redeploy), but `ownerId` genuinely owns the on-chain token now.
		// Register a spendable token under a guaranteed-unique numeric CardId,
		// keeping the real on-chain id on the doc, instead of failing the mint.
		realTokenId = tokenId
		// IDEMPOTENCY (critical): before minting a brand-new synthetic record,
		// check whether this owner ALREADY holds a spendable token for this
		// on-chain id. The direct mint path and the Alchemy reconcile webhook can
		// both register the same freshly-minted token within a second or two; the
		// old code created a fresh synthetic record on every call, so a recycled
		// id that hit this branch twice produced TWO passes for ONE on-chain token
		// (duplicate passes / inflated counter). Firestore queries are strongly
		// consistent, so the first registration's write is always visible here.
		if existing, found := findOwnerTokenByRealTokenId(ownerId, realTokenId); found {
			fmt.Printf("MintDraftTokenInDb: owner %s already holds realTokenId %s under cardId %s — idempotent skip (no duplicate)\n", ownerId, realTokenId, existing.CardId)
			return existing, nil
		}
		tokenId = generateUniqueTokenId()
		fmt.Printf("MintDraftTokenInDb: on-chain id %s collides (held by %s); registering under synthetic id %s for %s\r", realTokenId, oldToken.OwnerId, tokenId, ownerId)
	}

	// can hardcode the image to the draft token image we will use before the draft has been complete
	draftToken := &DraftToken{
		Roster:            NewEmptyRoster(strings.ToLower(ownerId)),
		DraftType:         "",
		CardId:            tokenId,
		RealTokenId:       realTokenId,
		ImageUrl:          "https://storage.googleapis.com/sbs-draft-token-images/thumbnails/draft-token-image-default_350x490.png",
		Level:             "Pro",
		OwnerId:           strings.ToLower(ownerId),
		LeagueId:          "",
		LeagueDisplayName: "",
		Rank:              "N/A",
		WeekScore:         "0",
		SeasonScore:       "0",
		PassType:          passType,
	}

	fmt.Println("Token inside of function: ", draftToken)

	// Patient writes (2026-07-21): registration is the bot/reconcile path with
	// an on-chain mint already behind it — a slow success beats a stranded
	// pass. Tokens 2739/2774 stranded here when a wedged channel outlived the
	// fast 3×2s profile.
	err = utils.Db.CreateOrUpdateDocumentPatient(utils.GetDraftTokenCollectionName(), tokenId, draftToken)
	if err != nil {
		return nil, err
	}
	path := fmt.Sprintf("owners/%s/validDraftTokens", strings.ToLower(ownerId))
	fmt.Println("Path: ", path)
	err = utils.Db.CreateOrUpdateDocumentPatient(path, tokenId, draftToken)
	if err != nil {
		fmt.Println("Error updating owner")
		return nil, err
	}
	fmt.Println("Added draft token to ownerid validDraftTokens")

	metadata := draftToken.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocumentPatient(utils.GetDraftTokenMetadataCollectionName(), tokenId, metadata)
	if err != nil {
		return nil, err
	}

	return draftToken, nil
}

func (dt *DraftToken) ConvertToMetadata() *Metadata {
	return &Metadata{
		Description: "Banana Best Ball, the first ever Web3 Fantasy Football Draft tournament on chain.",
		Name:        fmt.Sprintf("BBB pass #%s", dt.CardId),
		Image:       dt.ImageUrl,
		Attributes:  CreateTokenAttributes(dt),
	}
}

// https://storage.googleapis.com/sbs-fantasy-prod-draft-token-images/thumbnails/draft-token-image_350x490.png

func CreateTokenAttributes(dt *DraftToken) []Attributetrait_type {
	res := make([]Attributetrait_type, 0)
	for i := 0; i < len(dt.Roster.QB); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("QB%d", i+1),
			Value:      dt.Roster.QB[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.RB); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("RB%d", i+1),
			Value:      dt.Roster.RB[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.TE); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("TE%d", i+1),
			Value:      dt.Roster.TE[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.WR); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("WR%d", i+1),
			Value:      dt.Roster.WR[i].DisplayName,
		}
		res = append(res, obj)
	}
	for i := 0; i < len(dt.Roster.DST); i++ {
		obj := Attributetrait_type{
			Trait_Type: fmt.Sprintf("DST%d", i+1),
			Value:      dt.Roster.DST[i].DisplayName,
		}
		res = append(res, obj)
	}

	levelTrait := Attributetrait_type{
		Trait_Type: "LEVEL",
		Value:      dt.Level,
	}
	res = append(res, levelTrait)

	weekScoreTrait := Attributetrait_type{
		Trait_Type: "WEEK-SCORE",
		Value:      dt.WeekScore,
	}
	res = append(res, weekScoreTrait)

	seasonScoreTrait := Attributetrait_type{
		Trait_Type: "SEASON-SC0RE",
		Value:      dt.SeasonScore,
	}
	res = append(res, seasonScoreTrait)

	rankTrait := Attributetrait_type{
		Trait_Type: "RANK",
		Value:      dt.Rank,
	}
	res = append(res, rankTrait)

	leagueTrait := Attributetrait_type{
		Trait_Type: "LEAGUE-NAME",
		Value:      dt.LeagueDisplayName,
	}
	res = append(res, leagueTrait)

	leagueRankTrait := Attributetrait_type{
		Trait_Type: "LEAGUE-RANK",
		Value:      dt.LeagueRank,
	}
	res = append(res, leagueRankTrait)

	prizesTrait := Attributetrait_type{
		Trait_Type: "PRIZES",
		Value:      fmt.Sprintf("%f ETH", dt.Prizes.ETH),
	}
	res = append(res, prizesTrait)

	return res
}

func (token *DraftToken) GetDraftTokenFromDraftById(tokenId, draftId string) error {
	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/cards", draftId), tokenId, token)
	if err != nil {
		return err
	}
	return nil
}

// UpdateInUseDraftTokenInDatabase is the exported wrapper for staging package access.
func (token *DraftToken) UpdateInUseDraftTokenInDatabase(draftId string) error {
	return token.updateInUseDraftTokenInDatabase(draftId)
}

// Patient writes (2026-07-21): these are the in-use copies written after a
// seat is already committed — the exact writes that half-completed the
// fast-draft-196 join when the wedged channel outlasted the fast profile.
// Nothing here is under a pick clock; keep trying for up to ~a minute.
func (token *DraftToken) updateInUseDraftTokenInDatabase(draftId string) error {
	if token.LeagueId == "" {
		token.LeagueId = draftId
	}
	err := utils.Db.CreateOrUpdateDocumentPatient(utils.GetDraftTokenCollectionName(), token.CardId, token)
	if err != nil {
		return err
	}

	if token.LeagueId == "" {
		token.LeagueId = draftId
	}
	err = utils.Db.CreateOrUpdateDocumentPatient(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId, token)
	if err != nil {
		return err
	}
	if token.LeagueId == "" {
		token.LeagueId = draftId
	}
	err = utils.Db.CreateOrUpdateDocumentPatient(fmt.Sprintf("drafts/%s/cards", token.LeagueId), token.CardId, token)
	if err != nil {
		return err
	}

	metadata := token.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocumentPatient(utils.GetDraftTokenMetadataCollectionName(), token.CardId, metadata)
	if err != nil {
		return err
	}

	return nil
}

func (token *DraftToken) RemoveTokenFromLeague() error {
	oldLeagueId := token.LeagueId
	token.LeagueId = ""
	token.DraftType = ""
	token.LeagueDisplayName = ""
	err := utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenCollectionName(), token.CardId, token)
	if err != nil {
		return err
	}

	err = utils.Db.CreateOrUpdateDocument(fmt.Sprintf("owners/%s/validDraftTokens", token.OwnerId), token.CardId, token)
	if err != nil {

		return err
	}
	fmt.Println("Added card to valid draft tokens upon leaving draft at location: ", fmt.Sprintf("owners/%s/validDraftTokens", token.OwnerId))

	err = utils.Db.DeleteDocument(fmt.Sprintf("owners/%s/usedDraftTokens", token.OwnerId), token.CardId)
	if err != nil {
		fmt.Println("error when deleting document in owners")
		return err
	}

	fmt.Printf("drafts/%s/cards/%s", oldLeagueId, token.CardId)
	err = utils.Db.DeleteDocument(fmt.Sprintf("drafts/%s/cards", oldLeagueId), token.CardId)
	if err != nil {
		fmt.Println("error when deleting token from draft league: ", err)
		return err
	}

	metadata := token.ConvertToMetadata()
	err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenMetadataCollectionName(), token.CardId, metadata)
	if err != nil {
		return err
	}

	return nil

}

type ImageGeneratorRequest struct {
	Card DraftToken `json:"card"`
}

func (token *DraftToken) UpdateImageURL() (*DraftToken, error) {
	requestBody := &ImageGeneratorRequest{
		Card: *token,
	}

	data, err := json.Marshal(requestBody)
	if err != nil {
		fmt.Println("ERROR marhsalling request body: ", err)
		return nil, err
	}

	r, err := http.NewRequest("POST", imageGeneratorURL(), bytes.NewBuffer(data))
	if err != nil {
		fmt.Println("Error creating post request object")
		return nil, err
	}

	r.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	res, err := client.Do(r)
	if err != nil {
		fmt.Println("error completing the post request to update the card to have a new card image url: ", err)
		return nil, err
	}

	defer res.Body.Close()

	var UpdatedDraftToken DraftToken

	err = json.NewDecoder(res.Body).Decode(&UpdatedDraftToken)
	if err != nil {
		fmt.Println("error decoding the resonse from the image generator api:  ", err)
		return nil, err
	}

	return &UpdatedDraftToken, nil
}

func CheckTokenOwnershipForDraftTokens() error {
	numTokensMinted, err := utils.Contract.GetNumTokensMinted()
	if err != nil {
		fmt.Println("Error getting number of tokens minted from smart contract: ", err)
		return err
	}

	fmt.Println("NumTokensMinted: ", numTokensMinted)

	for i := 0; i < numTokensMinted; i++ {
		var token DraftToken
		err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), fmt.Sprintf("%d", i), &token)
		if err != nil {
			s := err.Error()
			if res := strings.Contains(s, "code = NotFound"); res {
				ownerId, err := utils.Contract.GetOwnerOfToken(i)
				if err != nil {
					fmt.Println("ERROR getting owner of token: ", err)
					return err
				}

				_, err = MintDraftTokenInDb(fmt.Sprintf("%d", i), strings.ToLower(ownerId), "paid")
				if err != nil {
					fmt.Println("Error minting draft token: ", err)
					return err
				}
				fmt.Printf("minted Token %d into database because the card is owned at the smart contract level and not in our database\r", i)
				continue
			}
		}

		contractOwner, err := utils.Contract.GetOwnerOfToken(i)
		if err != nil {
			fmt.Println("ERROR in getting contract owner: ", err)
			return err
		}

		if strings.EqualFold(strings.ToLower(contractOwner), strings.ToLower(token.OwnerId)) {
			continue
		}

		token.OwnerId = strings.ToLower(contractOwner)
		err = utils.Db.CreateOrUpdateDocument(utils.GetDraftTokenCollectionName(), token.CardId, &token)
		if err != nil {
			fmt.Println("ERROR updating token to new owner: ", err)
			return err
		}
	}

	fmt.Println("FInishsed updating owners for draft tokens")
	return nil
}

func round(num float64) int {
	return int(num + math.Copysign(0.5, num))
}

func toFixed(num float64, precision int) float64 {
	output := math.Pow(10, float64(precision))
	return float64(round(num*output)) / output
}

func TransferCreditOffOfDraftToken(cardId, ownerId, draftId string, amount float64) (*Transaction, error) {
	var token DraftToken
	err := utils.Db.ReadDocument(utils.GetDraftTokenCollectionName(), cardId, &token)
	if err != nil {
		fmt.Println("Error reading draft token in transfer route: ", err)
		return nil, err
	}
	if token.Prizes.ETH < amount {
		fmt.Printf("%s is trying to transfer more eth than is on Card %s", ownerId, cardId)
		return nil, fmt.Errorf("%s is trying to transfer more eth than is on Card %s", ownerId, cardId)
	}

	var owner Owner
	err = utils.Db.ReadDocument("owners", ownerId, &owner)
	if err != nil {
		s := err.Error()
		if res := strings.Contains(s, "code = NotFound"); res {
			newOwner, err := CreateOwnerDocument(ownerId)
			if err != nil {
				fmt.Println("ERror creating owner document for owner that does not have an owner document: ", err)
				return nil, err
			}
			fmt.Println("Created a fresh owner document in prize transfer for ", ownerId)
			owner = *newOwner
		} else {
			fmt.Println("Error reading owners document in transfer route: ", err)
			return nil, err
		}
	}

	cardNum, err := strconv.ParseInt(cardId, 10, 64)
	if err != nil {
		fmt.Println("COULD not parse card id to int")
	}

	if Environment == "prod" {
		contractOwner, _ := utils.Contract.GetOwnerOfToken(int(cardNum))
		if strings.ToLower(ownerId) != strings.ToLower(contractOwner) {
			fmt.Println("This owner is not the owner of this token")
			return nil, fmt.Errorf("this user is not the owner of this token")
		}
	}

	oldCard := token
	oldOwner := owner

	owner.AvailableEthCredit = toFixed(owner.AvailableEthCredit+amount, 5)
	token.Prizes.ETH = toFixed(token.Prizes.ETH-amount, 5)

	err = token.updateInUseDraftTokenInDatabase(draftId)
	if err != nil {
		fmt.Println("ERROR updating draft token after transferring eth: ", err)
		return nil, err
	}

	err = utils.Db.CreateOrUpdateDocument("owners", ownerId, owner)
	if err != nil {
		fmt.Println("ERROR updating owner in transfer: ", err)
		token.Prizes.ETH = math.Round((token.Prizes.ETH+amount)*100) / 100
		err = token.updateInUseDraftTokenInDatabase(draftId)
		if err != nil {
			fmt.Println("ERROR adding eth back to token after an error in owner update: ", err)
			return nil, err
		}
		return nil, err
	}

	tx, err := CreateTransferTransaction(oldCard, token, oldOwner, owner)
	if err != nil {
		fmt.Println("ERROR creating transfer transaction: ", err)
		return nil, err
	}
	fmt.Printf("Successfully transfered %f from Draft Token %s to %s", amount, cardId, ownerId)

	return tx, nil
}
