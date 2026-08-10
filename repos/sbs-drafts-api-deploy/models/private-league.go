package models

// Password-gated PRIVATE leagues (ticket-3338 — outside fantasy groups running
// their own league inside SBS, e.g. KFFL). A private league is a config doc at
// private_leagues/{id} plus a sequence of ordinary drafts in the public
// "<seasonYear>-<type>-draft-<n>" id space, each stamped with
// League.PrivateLeagueId so every join surface except the password-checked
// path refuses them (see seatTokenInLeagueTx).
//
// Each private league runs its OWN per-100 batch with the standard 1 Jackpot +
// 5 HOF, completely outside the public batch and WITHOUT VRF: positions are
// derived from a random 32-byte salt via the same DeriveBatchSlots algorithm
// the public batches use (byte-identical JS verifier already ships in
// banana-fantasy/lib/batchProof.ts). hex(sha256(salt)) is published on the
// league's page BEFORE the batch's first draft fills; the salt is revealed
// when the batch completes. A batch that never completes simply never reveals
// — unhit positions stay unknown forever, which is fine (nothing was owed;
// Richard 2026-08-10).
//
// Money flow: members buy ordinary passes from the site and spend them here —
// a private seat consumes a pass exactly like a public seat.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/batchproof"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

const (
	privateLeaguesCollection       = "private_leagues"
	privateLeagueSecretsCollection = "private_league_secrets"
	// privateLeagueReserveOffset: new private drafts are created a few numbers
	// AHEAD of the public filling frontier so a private create can never race a
	// public walk-forward create on the same number (the public path only
	// creates a doc it failed to READ — by the time the frontier reaches a
	// private number, the doc long exists and the read finds it → sentinel
	// skip). 3 lobbies of headroom is far more than fills in the millisecond
	// window a create takes.
	privateLeagueReserveOffset = 3
)

// PrivateLeagueConfig is the Firestore doc at private_leagues/{id}. Created by
// the admin seeding script (scripts on the frontend repo), read here. Field
// names are stored PascalCase (Go Firestore default — same convention as every
// other model in this package).
type PrivateLeagueConfig struct {
	// Name is the display label used on the league page and in draft names
	// ("KFFL" → drafts "KFFL #1", "KFFL #2", …).
	Name string `json:"name"`
	// PasswordHash = hex(sha256(trimmed password)). Never serialized to JSON.
	PasswordHash string `json:"-"`
	// DraftType is the speed every draft in this league runs at: "fast"
	// (30s/pick, ~30min total) or "slow" (8h/pick).
	DraftType string `json:"draftType"`
	// CurrentDraftId is the currently-filling draft ("" until the first join;
	// advanced by ensureOpenPrivateLeague when the current one fills).
	CurrentDraftId     string    `json:"currentDraftId"`
	CommissionerWallet string    `json:"commissionerWallet,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
}

// PrivateBatchProof is the PUBLIC face of one private batch's commit-reveal,
// stored at private_leagues/{id}/batches/{n}. CommitHash is written before the
// batch's first draft fills; SaltHex + positions appear only at reveal.
type PrivateBatchProof struct {
	Batch      int       `json:"batch"`
	CommitHash string    `json:"commitHash"`
	CreatedAt  time.Time `json:"createdAt"`
	// Reveal fields — zero until the batch's 100th draft fills.
	SaltHex         string    `json:"saltHex,omitempty"`
	JackpotPosition int       `json:"jackpotPosition,omitempty"` // 1-indexed within the batch
	HofPositions    []int     `json:"hofPositions,omitempty"`    // 1-indexed within the batch
	RevealedAt      time.Time `json:"revealedAt,omitempty"`
	Revealed        bool      `json:"revealed"`
}

// privateBatchSecret holds the salt at private_league_secrets/{id}-batch-{n}.
// The collection is never exposed by any endpoint; only the reveal path copies
// the salt into the public batch doc.
type privateBatchSecret struct {
	SaltHex   string    `json:"saltHex"`
	CreatedAt time.Time `json:"createdAt"`
}

var errPrivateLeagueBadPassword = errors.New("incorrect password for this private league")

// ErrIsPrivateLeagueBadPassword lets handlers map the failure to a 403 instead
// of a generic 500.
func ErrIsPrivateLeagueBadPassword(err error) bool {
	return errors.Is(err, errPrivateLeagueBadPassword)
}

// ErrIsPrivateAlreadyInDraft maps "you already have a seat in the current
// draft" to a 409 in the handler.
func ErrIsPrivateAlreadyInDraft(err error) bool { return errors.Is(err, errAlreadyInLeague) }

// HashPrivateLeaguePassword is the single canonical password→hash mapping,
// used by both the verifier here and the admin seeding script (which stores
// its output). Trims whitespace so a copy-pasted password with a stray space
// still works; case-SENSITIVE beyond that.
func HashPrivateLeaguePassword(password string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(password)))
	return hex.EncodeToString(sum[:])
}

// GetPrivateLeagueConfig reads private_leagues/{id}. NotFound bubbles up as-is
// (handlers map it to 404).
func GetPrivateLeagueConfig(privateId string) (*PrivateLeagueConfig, error) {
	var cfg PrivateLeagueConfig
	if err := utils.Db.ReadDocument(privateLeaguesCollection, privateId, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// verifyPrivateLeaguePassword checks a caller-supplied password against the
// config. Constant-time compare; a config with an EMPTY hash always fails
// closed (a half-seeded league must not be joinable).
func verifyPrivateLeaguePassword(cfg *PrivateLeagueConfig, password string) error {
	if cfg.PasswordHash == "" {
		return errPrivateLeagueBadPassword
	}
	supplied := HashPrivateLeaguePassword(password)
	if subtle.ConstantTimeCompare([]byte(supplied), []byte(cfg.PasswordHash)) != 1 {
		return errPrivateLeagueBadPassword
	}
	return nil
}

// ensurePrivateBatchSeed returns the salt for (privateId, batchNum), creating
// it — and publishing its commit hash — atomically on first use. The create
// runs in a transaction keyed on the SECRET doc so two concurrent first-fills
// of a new batch derive the same positions.
func ensurePrivateBatchSeed(privateId string, batchNum int) ([]byte, error) {
	secretRef := utils.Db.Client.Collection(privateLeagueSecretsCollection).Doc(fmt.Sprintf("%s-batch-%d", privateId, batchNum))
	commitRef := utils.Db.Client.Collection(privateLeaguesCollection).Doc(privateId).Collection("batches").Doc(fmt.Sprintf("%d", batchNum))

	var saltHex string
	err := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		snap, gerr := tx.Get(secretRef)
		if gerr == nil && snap.Exists() {
			var sec privateBatchSecret
			if derr := snap.DataTo(&sec); derr != nil {
				return derr
			}
			saltHex = sec.SaltHex
			return nil
		}
		if gerr != nil && !strings.Contains(gerr.Error(), "code = NotFound") {
			return gerr
		}
		salt := make([]byte, 32)
		if _, rerr := rand.Read(salt); rerr != nil {
			return rerr
		}
		saltHex = hex.EncodeToString(salt)
		commit := sha256.Sum256(salt)
		now := time.Now()
		if serr := tx.Set(secretRef, &privateBatchSecret{SaltHex: saltHex, CreatedAt: now}); serr != nil {
			return serr
		}
		return tx.Set(commitRef, &PrivateBatchProof{
			Batch:      batchNum,
			CommitHash: hex.EncodeToString(commit[:]),
			CreatedAt:  now,
			Revealed:   false,
		})
	})
	if err != nil {
		return nil, err
	}
	return hex.DecodeString(saltHex)
}

// PrivateSlotFor derives whether draft number `count` (1-indexed within the
// private league's own sequence) is the batch's Jackpot or one of its 5 HOF
// slots. Returns the batch number alongside so the fill path can trigger the
// reveal when the batch completes.
func PrivateSlotFor(privateId string, count int) (isJackpot bool, isHOF bool, batchNum int, err error) {
	if count < 1 {
		return false, false, 0, fmt.Errorf("private draft count must be >= 1, got %d", count)
	}
	batchNum = (count-1)/batchproof.BatchSize + 1
	pos := (count - 1) % batchproof.BatchSize // 0-indexed, matches DeriveBatchSlots

	salt, err := ensurePrivateBatchSeed(privateId, batchNum)
	if err != nil {
		return false, false, batchNum, err
	}
	slots, err := batchproof.DeriveBatchSlots(salt, batchNum)
	if err != nil {
		return false, false, batchNum, err
	}
	if pos == slots.JackpotPosition {
		isJackpot = true
	}
	for _, h := range slots.HofPositions {
		if pos == h {
			isHOF = true
			break
		}
	}
	return isJackpot, isHOF, batchNum, nil
}

// RevealPrivateBatch copies the salt into the public batch doc together with
// the derived positions (1-indexed for display). Idempotent — re-running
// overwrites with identical data. Called async when a batch's 100th draft
// fills; can also be hand-run for an end-of-season reveal if Richard ever
// wants one (unhit positions in an incomplete batch stay sealed by default).
func RevealPrivateBatch(privateId string, batchNum int) error {
	var sec privateBatchSecret
	if err := utils.Db.ReadDocument(privateLeagueSecretsCollection, fmt.Sprintf("%s-batch-%d", privateId, batchNum), &sec); err != nil {
		return err
	}
	salt, err := hex.DecodeString(sec.SaltHex)
	if err != nil {
		return err
	}
	slots, err := batchproof.DeriveBatchSlots(salt, batchNum)
	if err != nil {
		return err
	}
	commit := sha256.Sum256(salt)
	hof := make([]int, 0, len(slots.HofPositions))
	for _, h := range slots.HofPositions {
		hof = append(hof, h+1)
	}
	proof := &PrivateBatchProof{
		Batch:           batchNum,
		CommitHash:      hex.EncodeToString(commit[:]),
		CreatedAt:       sec.CreatedAt,
		SaltHex:         sec.SaltHex,
		JackpotPosition: slots.JackpotPosition + 1,
		HofPositions:    hof,
		RevealedAt:      time.Now(),
		Revealed:        true,
	}
	return utils.Db.CreateOrUpdateDocument(
		fmt.Sprintf("%s/%s/batches", privateLeaguesCollection, privateId),
		fmt.Sprintf("%d", batchNum),
		proof,
	)
}

// ensureOpenPrivateLeague resolves the draft the next private join should
// target, allocating a fresh league doc (a few numbers ahead of the public
// frontier — see privateLeagueReserveOffset) when there is no open one. Runs
// as a single transaction on the config doc, so a burst of members joining at
// once converges on ONE league instead of scattering across several.
func ensureOpenPrivateLeague(privateId string, cfg *PrivateLeagueConfig) (string, error) {
	cfgRef := utils.Db.Client.Collection(privateLeaguesCollection).Doc(privateId)
	trackerRef := utils.Db.Client.Collection("drafts").Doc("draftTracker")

	draftType := strings.ToLower(cfg.DraftType)
	if draftType != "slow" {
		draftType = "fast"
	}

	var resolved string
	err := utils.Db.Client.RunTransaction(context.Background(), func(ctx context.Context, tx *firestore.Transaction) error {
		resolved = ""
		cfgSnap, err := tx.Get(cfgRef)
		if err != nil {
			return err
		}
		var fresh PrivateLeagueConfig
		if err := cfgSnap.DataTo(&fresh); err != nil {
			return err
		}

		// Reuse the current draft while it still has open seats.
		if fresh.CurrentDraftId != "" {
			snap, gerr := tx.Get(utils.Db.Client.Collection("drafts").Doc(fresh.CurrentDraftId))
			if gerr == nil && snap.Exists() {
				var l League
				if derr := snap.DataTo(&l); derr != nil {
					return derr
				}
				if l.PrivateLeagueId == privateId && l.NumPlayers < 10 {
					resolved = fresh.CurrentDraftId
					return nil
				}
			} else if gerr != nil && !strings.Contains(gerr.Error(), "code = NotFound") {
				return gerr
			}
		}

		// Allocate a new league number ahead of the public frontier. All reads
		// (tracker + candidate probes) happen before any write, as Firestore
		// transactions require.
		tSnap, err := tx.Get(trackerRef)
		if err != nil {
			return err
		}
		var t DraftLeagueTracker
		if err := tSnap.DataTo(&t); err != nil {
			return err
		}
		frontier := t.CurrentLiveDraftCount
		if draftType == "slow" {
			frontier = t.CurrentSlowDraftCount
		}

		candidate := 0
		for n := frontier + 1 + privateLeagueReserveOffset; n < frontier+1+privateLeagueReserveOffset+25; n++ {
			id := fmt.Sprintf(seasonYear+"-%s-draft-%d", draftType, n)
			_, gerr := tx.Get(utils.Db.Client.Collection("drafts").Doc(id))
			if gerr != nil && strings.Contains(gerr.Error(), "code = NotFound") {
				candidate = n
				break
			}
			if gerr != nil {
				return gerr
			}
			// Doc exists (public lobby pre-created, or another private league) —
			// keep walking.
		}
		if candidate == 0 {
			return fmt.Errorf("could not find a free draft number for private league %s", privateId)
		}

		leagueId := fmt.Sprintf(seasonYear+"-%s-draft-%d", draftType, candidate)
		loc, lerr := time.LoadLocation("America/Los_Angeles")
		if lerr != nil {
			return lerr
		}
		newLeague := &League{
			LeagueId:        leagueId,
			DisplayName:     cfg.Name,
			CurrentUsers:    make([]LeagueUser, 0),
			NumPlayers:      0,
			MaxPlayers:      10,
			StartDate:       time.Date(2024, time.September, 28, 0, 0, 0, 0, loc),
			EndDate:         time.Date(2024, time.December, 25, 0, 0, 0, 0, loc),
			DraftType:       draftType,
			Level:           "Pro",
			IsLocked:        false,
			ADP:             SnapshotADPForLeague(leagueId),
			PrivateLeagueId: privateId,
		}
		if serr := tx.Set(utils.Db.Client.Collection("drafts").Doc(leagueId), newLeague); serr != nil {
			return serr
		}
		if serr := tx.Set(cfgRef, map[string]interface{}{"CurrentDraftId": leagueId}, firestore.MergeAll); serr != nil {
			return serr
		}
		resolved = leagueId
		return nil
	})
	if err != nil {
		return "", err
	}
	return resolved, nil
}

// JoinPrivateLeague seats ownerId in privateId's currently-filling draft after
// verifying the password. Consumes one pass of passType exactly like a public
// join; runs the SAME seat transaction and post-join bookkeeping (fill trigger
// included) as every other join. Returns the seated card.
func JoinPrivateLeague(privateId string, ownerId string, password string, passType string) (*DraftToken, error) {
	cfg, err := GetPrivateLeagueConfig(privateId)
	if err != nil {
		return nil, err
	}
	if err := verifyPrivateLeaguePassword(cfg, password); err != nil {
		fmt.Printf("[private-league] bad password attempt league=%s owner=%s\n", privateId, ownerId)
		return nil, err
	}

	// Same pass selection as the public join: lowest-numbered spendable pass
	// of the chosen type.
	data, err := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", ownerId)).Documents(context.Background()).GetAll()
	if err != nil {
		return nil, err
	}
	allTokens := make([]DraftToken, 0, len(data))
	for _, d := range data {
		var t DraftToken
		if err := d.DataTo(&t); err != nil {
			return nil, err
		}
		allTokens = append(allTokens, t)
	}
	selected, err := selectTokensByType(allTokens, passType, 1)
	if err != nil {
		return nil, err
	}
	token := selected[0]

	draftType := strings.ToLower(cfg.DraftType)
	if draftType != "slow" {
		draftType = "fast"
	}

	// Resolve-and-seat with a small retry: if the current draft fills between
	// resolve and seat (10 buddies mashing join at once), re-resolve — the
	// next pass allocates the following league.
	for attempt := 0; attempt < 3; attempt++ {
		leagueId, lerr := ensureOpenPrivateLeague(privateId, cfg)
		if lerr != nil {
			return nil, lerr
		}
		leagueRef := utils.Db.Client.Collection("drafts").Doc(leagueId)
		validTokenRef := utils.Db.Client.Collection(fmt.Sprintf("owners/%s/validDraftTokens", ownerId)).Doc(token.CardId)
		seated, serr := seatTokenInLeagueTx(leagueRef, validTokenRef, &token, draftType, privateId)
		if serr != nil {
			if errors.Is(serr, errLeagueFull) {
				continue
			}
			return nil, serr
		}
		if ferr := finalizeSeatedJoin(&token, seated, leagueId, draftType); ferr != nil {
			return nil, ferr
		}
		return &token, nil
	}
	return nil, fmt.Errorf("could not find an open draft for private league %s after 3 attempts", privateId)
}

// PrivateLeagueDraftSummary is one row of the league page's draft list.
type PrivateLeagueDraftSummary struct {
	DraftId     string `json:"draftId"`
	DisplayName string `json:"displayName"`
	Level       string `json:"level"`
	NumPlayers  int    `json:"numPlayers"`
	Filled      bool   `json:"filled"`
}

// PrivateLeagueInfo is the league page payload (password-gated).
type PrivateLeagueInfo struct {
	Id            string                      `json:"id"`
	Name          string                      `json:"name"`
	DraftType     string                      `json:"draftType"`
	DraftsFilled  int                         `json:"draftsFilled"`
	CurrentDraft  *PrivateLeagueDraftSummary  `json:"currentDraft,omitempty"`
	Drafts        []PrivateLeagueDraftSummary `json:"drafts"`
	Batches       []PrivateBatchProof         `json:"batches"`
	BatchSize     int                         `json:"batchSize"`
	JackpotPer100 int                         `json:"jackpotPer100"`
	HofPer100     int                         `json:"hofPer100"`
}

// GetPrivateLeagueInfo builds the league page payload after verifying the
// password. Lists every draft stamped with this private id (single-field
// Firestore index — no composite needed) plus each batch's commit/reveal.
func GetPrivateLeagueInfo(privateId string, password string) (*PrivateLeagueInfo, error) {
	cfg, err := GetPrivateLeagueConfig(privateId)
	if err != nil {
		return nil, err
	}
	if err := verifyPrivateLeaguePassword(cfg, password); err != nil {
		return nil, err
	}

	ctx := context.Background()
	info := &PrivateLeagueInfo{
		Id:            privateId,
		Name:          cfg.Name,
		DraftType:     cfg.DraftType,
		Drafts:        make([]PrivateLeagueDraftSummary, 0),
		Batches:       make([]PrivateBatchProof, 0),
		BatchSize:     batchproof.BatchSize,
		JackpotPer100: batchproof.JackpotCount,
		HofPer100:     batchproof.HofCount,
	}

	var tracker DraftLeagueTracker
	if err := utils.Db.ReadDocument("drafts", "draftTracker", &tracker); err == nil {
		info.DraftsFilled = tracker.PrivateDraftCounts[privateId]
	}

	docs, err := utils.Db.Client.Collection("drafts").
		Where("PrivateLeagueId", "==", privateId).
		Documents(ctx).GetAll()
	if err != nil {
		return nil, err
	}
	for _, d := range docs {
		var l League
		if derr := d.DataTo(&l); derr != nil {
			continue
		}
		row := PrivateLeagueDraftSummary{
			DraftId:     l.LeagueId,
			DisplayName: l.DisplayName,
			Level:       l.Level,
			NumPlayers:  l.NumPlayers,
			Filled:      l.NumPlayers >= 10,
		}
		info.Drafts = append(info.Drafts, row)
		if l.LeagueId == cfg.CurrentDraftId && l.NumPlayers < 10 {
			cur := row
			info.CurrentDraft = &cur
		}
	}

	batchDocs, err := utils.Db.Client.Collection(privateLeaguesCollection).Doc(privateId).
		Collection("batches").Documents(ctx).GetAll()
	if err == nil {
		for _, b := range batchDocs {
			var p PrivateBatchProof
			if derr := b.DataTo(&p); derr != nil {
				continue
			}
			// Belt-and-suspenders: never serve the salt for an unrevealed batch
			// even if a doc were hand-edited into a weird state.
			if !p.Revealed {
				p.SaltHex = ""
				p.JackpotPosition = 0
				p.HofPositions = nil
			}
			info.Batches = append(info.Batches, p)
		}
	}

	return info, nil
}
