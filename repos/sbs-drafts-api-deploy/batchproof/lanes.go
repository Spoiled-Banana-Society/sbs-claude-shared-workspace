// Rolling reset windows — the lane system that replaces fixed per-100 batches
// from draft `RollingStartDraft` (201) onward. Spec: shared-workspace
// NOTES_FOR_BORIS_2026-07-19_rolling_windows_jackhof.md (v2, Richard-approved).
//
// Two INDEPENDENT lanes, each a rolling 100-draft window:
//   - jp:  1 slot per window. On hit at draft X the window completes and the
//     next window starts at X+1.
//   - hof: 5 distinct slots per window. Completes when the 5th hits.
//
// Each lane CYCLE gets its own commit-reveal on the SAME BBB4BatchProofVRFCommit
// contract + Chainlink subscription as the legacy batches, keyed by
// laneKey = laneKeyBase + cycleNumber (jp base 1_000_000, hof base 2_000_000) so
// lane entries can never collide with legacy batch numbers (1..999_999).
//
// Flow per cycle (mirrors the legacy vrf-commit flow byte-for-byte where it
// matters): generate salt → commit saltHash on-chain + request VRF randomness
// (one atomic tx) → on fulfillment derive positions from
// CombinedSeed(salt, randomness) → store hidden in lane_proofs/{lane}-{cycle}
// → on cycle completion reveal the salt on-chain and immediately open the next
// cycle. Derivation tags are the spec's exact byte layout:
//
//	tag = "<lane>:<cycle>:<i>"            e.g. "jp:1:0", "hof:3:2"
//	pos = uint64(first 8 bytes BE of HMAC-SHA256(combinedSeed, tag)) % 100
//	collision walk: +1 mod 100, WITHIN the lane's own slots only.
//	global draft number = windowStartDraft + pos
//
// Cross-lane collisions are allowed and meaningful: both lanes landing the same
// draft = JackHOF (dual-type). No cross-lane rule exists at all.
//
// KEEPING THE HOT PATH FAST (wheel-latency lesson): commit+VRF for the NEXT
// cycle fires in a background goroutine at the moment a cycle completes, so by
// the time the next window's first draft fills the positions are already in
// Firestore and the fill path takes the fast read. The only blocking wait is
// the same first-fill-after-boundary VRF wait the legacy system already has.
package batchproof

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	LaneJP  = "jp"
	LaneHOF = "hof"

	LaneWindow   = 100
	laneJPSlots  = 1
	laneHOFSlots = 5

	laneKeyBaseJP  = 1_000_000
	laneKeyBaseHOF = 2_000_000

	laneProofsCollection = "lane_proofs"
	laneMetaDocID        = "_meta"

	// DefaultRollingStartDraft is the agreed cutover draft. Overridable via
	// LANES_ARM_DRAFT for a re-target (e.g. 301) without a code change.
	DefaultRollingStartDraft = 201
)

// LanesArmDraft returns the draft number the rolling system arms at.
func LanesArmDraft() int {
	if v := strings.TrimSpace(os.Getenv("LANES_ARM_DRAFT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return DefaultRollingStartDraft
}

// LanesDisabled is the escape hatch: set LANES_DISABLED=1 to force the legacy
// batch path regardless of draft number (used only if something goes wrong
// before the tracker's RollingStartDraft is written; after that the tracker
// field is the master switch and deleting it is the rollback).
func LanesDisabled() bool {
	return os.Getenv("LANES_DISABLED") == "1"
}

func laneKey(lane string, cycle int) int {
	if lane == LaneHOF {
		return laneKeyBaseHOF + cycle
	}
	return laneKeyBaseJP + cycle
}

func laneSlotCount(lane string) int {
	if lane == LaneHOF {
		return laneHOFSlots
	}
	return laneJPSlots
}

// DeriveLaneSlots reproduces the spec's derivation exactly. Returns 0-indexed
// positions within the window (0..99), in derivation order (i = 0..count-1).
// MUST stay byte-identical to the client verifier in lib/batchProof.ts once
// Richard's side mirrors it.
func DeriveLaneSlots(combinedSeed []byte, lane string, cycle int, count int) ([]int, error) {
	if len(combinedSeed) == 0 {
		return nil, fmt.Errorf("empty seed")
	}
	if cycle < 1 {
		return nil, fmt.Errorf("cycle must be >= 1, got %d", cycle)
	}
	if count < 1 || count > LaneWindow {
		return nil, fmt.Errorf("bad slot count %d", count)
	}
	taken := make(map[int]bool, count)
	positions := make([]int, count)
	for i := 0; i < count; i++ {
		tag := fmt.Sprintf("%s:%d:%d", lane, cycle, i)
		h := hmac.New(sha256.New, combinedSeed)
		h.Write([]byte(tag))
		mac := h.Sum(nil)
		pos := int(binary.BigEndian.Uint64(mac[:8]) % LaneWindow)
		for taken[pos] {
			pos = (pos + 1) % LaneWindow
		}
		taken[pos] = true
		positions[i] = pos
	}
	return positions, nil
}

// LaneCycleDoc is the Firestore record for one lane cycle, stored at
// lane_proofs/{lane}-{cycle}. Field names deliberately mirror batch_proofs so
// the eventual proof UI can share rendering. StartDraft is EXPLICIT (the
// off-by-100 batchStart label lesson — nothing here is derived by convention).
type LaneCycleDoc struct {
	Lane        string `firestore:"lane"`
	Cycle       int    `firestore:"cycle"`
	LaneKey     int    `firestore:"laneKey"`
	StartDraft  int    `firestore:"startDraft"`  // global draft # of window start (window = start..start+99)
	Status      string `firestore:"status"`      // requested → fulfilled → revealed
	Variant     string `firestore:"variant"`     // always vrf-commit
	SaltHash    string `firestore:"saltHash"`
	ServerSalt  string `firestore:"serverSalt"`  // hidden until reveal; gated by status like batch_proofs
	CommitTx    string `firestore:"commitTxHash"`
	RequestedAt int64  `firestore:"vrfRequestedAt"`
	VRFRequestID string `firestore:"vrfRequestId,omitempty"`
	VRFRandomness string `firestore:"vrfRandomness,omitempty"`
	FulfilledAt int64  `firestore:"vrfFulfilledAt,omitempty"`
	Positions   []int  `firestore:"positions,omitempty"`   // 0-indexed within window, derivation order
	Globals     []int  `firestore:"globalDraftIds,omitempty"` // StartDraft + pos, sorted asc
	RevealTx    string `firestore:"revealTxHash,omitempty"`
	RevealedAt  int64  `firestore:"revealedAt,omitempty"`
	CompletedAtDraft int `firestore:"completedAtDraft,omitempty"` // draft # whose fill completed the cycle
}

// laneMeta is the tiny pointer doc at lane_proofs/_meta tracking each lane's
// CURRENT cycle. Updated transactionally on rollover.
type laneMeta struct {
	JPCycle   int `firestore:"jpCycle"`
	JPStart   int `firestore:"jpStart"`
	HOFCycle  int `firestore:"hofCycle"`
	HOFStart  int `firestore:"hofStart"`
	ArmDraft  int `firestore:"armDraft"`
}

func laneDocID(lane string, cycle int) string { return fmt.Sprintf("%s-%d", lane, cycle) }

func loadLaneCycle(ctx context.Context, db *firestore.Client, lane string, cycle int) (*LaneCycleDoc, error) {
	snap, err := db.Collection(laneProofsCollection).Doc(laneDocID(lane, cycle)).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s/%s: %w", laneProofsCollection, laneDocID(lane, cycle), err)
	}
	var doc LaneCycleDoc
	if err := snap.DataTo(&doc); err != nil {
		return nil, fmt.Errorf("decode %s: %w", laneDocID(lane, cycle), err)
	}
	return &doc, nil
}

func saveLaneCycle(ctx context.Context, db *firestore.Client, doc *LaneCycleDoc) error {
	_, err := db.Collection(laneProofsCollection).Doc(laneDocID(doc.Lane, doc.Cycle)).Set(ctx, doc)
	return err
}

func mergeLaneCycle(ctx context.Context, db *firestore.Client, lane string, cycle int, updates map[string]interface{}) error {
	_, err := db.Collection(laneProofsCollection).Doc(laneDocID(lane, cycle)).Set(ctx, updates, firestore.MergeAll)
	return err
}

func (m *Manager) loadLaneMeta(ctx context.Context) (*laneMeta, error) {
	snap, err := m.db.Collection(laneProofsCollection).Doc(laneMetaDocID).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read lane meta: %w", err)
	}
	var meta laneMeta
	if err := snap.DataTo(&meta); err != nil {
		return nil, fmt.Errorf("decode lane meta: %w", err)
	}
	return &meta, nil
}

// InitLanes creates the meta doc + both lanes' first cycles if absent.
// Idempotent — safe to call any number of times. Called by the pre-commit
// admin step AND lazily from the fill path as a backstop.
func (m *Manager) InitLanes(ctx context.Context, armDraft int) error {
	meta, err := m.loadLaneMeta(ctx)
	if err != nil {
		return err
	}
	if meta == nil {
		meta = &laneMeta{JPCycle: 1, JPStart: armDraft, HOFCycle: 1, HOFStart: armDraft, ArmDraft: armDraft}
		// create() semantics: only one initializer wins.
		_, err := m.db.Collection(laneProofsCollection).Doc(laneMetaDocID).Create(ctx, meta)
		if err != nil && status.Code(err) != codes.AlreadyExists {
			return fmt.Errorf("create lane meta: %w", err)
		}
		if err == nil {
			fmt.Printf("[lanes] initialized: jp cycle 1 + hof cycle 1, windows start at draft %d\n", armDraft)
		}
		// re-load in case another initializer won with different values
		meta, err = m.loadLaneMeta(ctx)
		if err != nil {
			return err
		}
	}
	// Ensure both current cycles are committed + (eagerly) derived.
	if _, err := m.ensureLaneCycleSlots(ctx, LaneJP, meta.JPCycle, meta.JPStart); err != nil {
		return fmt.Errorf("ensure jp cycle %d: %w", meta.JPCycle, err)
	}
	if _, err := m.ensureLaneCycleSlots(ctx, LaneHOF, meta.HOFCycle, meta.HOFStart); err != nil {
		return fmt.Errorf("ensure hof cycle %d: %w", meta.HOFCycle, err)
	}
	return nil
}

// EnsureLaneCyclesFor guarantees both lanes have committed+derived cycles
// whose windows cover draft `draftNum`, and returns each lane's CURRENT-cycle
// global draft ids. Blocks (bounded by ctx) only when a cycle's VRF hasn't
// fulfilled yet — the same boundary wait the legacy system has.
func (m *Manager) EnsureLaneCyclesFor(ctx context.Context, draftNum int) (jpGlobals []int, hofGlobals []int, err error) {
	meta, err := m.loadLaneMeta(ctx)
	if err != nil {
		return nil, nil, err
	}
	if meta == nil {
		if err := m.InitLanes(ctx, LanesArmDraft()); err != nil {
			return nil, nil, err
		}
		meta, err = m.loadLaneMeta(ctx)
		if err != nil || meta == nil {
			return nil, nil, fmt.Errorf("lane meta missing after init: %v", err)
		}
	}
	// Sanity: the window must cover draftNum. By construction it always does
	// (completion advances start to hit+1, and every window spans 100), but a
	// stale meta read after a concurrent rollover could lag one cycle — the
	// membership check in the fill path tolerates that (a stale cycle's globals
	// simply don't contain draftNum, and RecentFills/reveal never lie).
	jpGlobals, err = m.ensureLaneCycleSlots(ctx, LaneJP, meta.JPCycle, meta.JPStart)
	if err != nil {
		return nil, nil, fmt.Errorf("jp cycle %d: %w", meta.JPCycle, err)
	}
	hofGlobals, err = m.ensureLaneCycleSlots(ctx, LaneHOF, meta.HOFCycle, meta.HOFStart)
	if err != nil {
		return nil, nil, fmt.Errorf("hof cycle %d: %w", meta.HOFCycle, err)
	}
	return jpGlobals, hofGlobals, nil
}

// ensureLaneCycleSlots is the lane analogue of ensureBatchHasVRFCommitSlots.
// Returns the cycle's SORTED global draft ids.
func (m *Manager) ensureLaneCycleSlots(ctx context.Context, lane string, cycle int, startDraft int) ([]int, error) {
	key := laneKey(lane, cycle)
	lock := m.lockFor(key)
	lock.Lock()
	defer lock.Unlock()

	existing, err := loadLaneCycle(ctx, m.db, lane, cycle)
	if err != nil {
		return nil, err
	}

	// Fast path — derived already.
	if existing != nil && (existing.Status == "fulfilled" || existing.Status == "revealed") && len(existing.Globals) > 0 {
		return existing.Globals, nil
	}

	// Mid-flight — request submitted, wait for fulfillment then derive.
	if existing != nil && existing.Status == "requested" {
		state, err := m.client.WaitForVRFCommitFulfillment(ctx, key, 5*time.Second, 5*time.Minute)
		if err != nil {
			return nil, fmt.Errorf("wait fulfillment: %w", err)
		}
		return m.deriveAndPersistLaneSlots(ctx, lane, cycle, startDraft, state, existing)
	}

	// Cold start — salt, commit+request, wait, derive.
	saltBytes, err := GenerateSeed()
	if err != nil {
		return nil, fmt.Errorf("generate salt: %w", err)
	}
	saltHash := SeedHash(saltBytes)

	res, err := m.client.RequestRandomnessAndCommit(ctx, key, saltHash)
	if err != nil {
		return nil, fmt.Errorf("requestRandomnessAndCommit lane %s cycle %d: %w", lane, cycle, err)
	}
	chainState, _ := m.client.GetBatchVRFCommit(ctx, key)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}
	doc := &LaneCycleDoc{
		Lane: lane, Cycle: cycle, LaneKey: key, StartDraft: startDraft,
		Status: "requested", Variant: VariantVRFCommit,
		SaltHash:   "0x" + hex.EncodeToString(saltHash.Bytes()),
		ServerSalt: "0x" + hex.EncodeToString(saltBytes),
		CommitTx:   res.TxHash.Hex(), RequestedAt: time.Now().Unix(),
		VRFRequestID: requestID,
	}
	if err := saveLaneCycle(ctx, m.db, doc); err != nil {
		return nil, fmt.Errorf("persist requested lane doc: %w", err)
	}
	fmt.Printf("[lanes] committed %s cycle %d (window %d-%d) tx=%s\n", lane, cycle, startDraft, startDraft+LaneWindow-1, res.TxHash.Hex())

	state, err := m.client.WaitForVRFCommitFulfillment(ctx, key, 5*time.Second, 5*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("wait fulfillment: %w", err)
	}
	return m.deriveAndPersistLaneSlots(ctx, lane, cycle, startDraft, state, doc)
}

func (m *Manager) deriveAndPersistLaneSlots(ctx context.Context, lane string, cycle int, startDraft int, state VRFCommitBatchState, doc *LaneCycleDoc) ([]int, error) {
	if doc == nil || doc.ServerSalt == "" {
		return nil, fmt.Errorf("lane %s cycle %d: server salt missing", lane, cycle)
	}
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return nil, fmt.Errorf("lane %s cycle %d: invalid stored salt: %v", lane, cycle, err)
	}
	randomness := state.RandomnessSeed()
	if len(randomness) != 32 {
		return nil, fmt.Errorf("lane %s cycle %d: VRF returned %d-byte randomness", lane, cycle, len(randomness))
	}
	combined := CombinedSeed(saltBytes, randomness)
	positions, err := DeriveLaneSlots(combined, lane, cycle, laneSlotCount(lane))
	if err != nil {
		return nil, fmt.Errorf("derive lane slots: %w", err)
	}
	globals := make([]int, len(positions))
	for i, p := range positions {
		globals[i] = startDraft + p
	}
	sort.Ints(globals)
	updates := map[string]interface{}{
		"status":         "fulfilled",
		"vrfRandomness":  "0x" + hex.EncodeToString(randomness),
		"vrfFulfilledAt": int64(state.FulfilledAt),
		"positions":      positions,
		"globalDraftIds": globals,
	}
	if err := mergeLaneCycle(ctx, m.db, lane, cycle, updates); err != nil {
		return nil, fmt.Errorf("merge lane fulfillment: %w", err)
	}
	fmt.Printf("[lanes] derived %s cycle %d → globals=%v (hidden until reveal)\n", lane, cycle, globals)
	return globals, nil
}

// LaneAfterAssignment runs AFTER a draft's type has been assigned and the
// tracker updated. If the fill completed a lane's cycle (JP hit, or 5th HOF
// hit), it: (1) reveals that cycle's salt on-chain (background), (2) advances
// the lane meta to the next cycle starting at draftNum+1, and (3) eagerly
// commits + derives the next cycle in the background so the next fill never
// waits. Idempotent under the completed-cycle's lock; best-effort — never
// blocks or fails the caller's fill path.
func (m *Manager) LaneAfterAssignment(draftNum int, hitJP bool, hitHOF bool) {
	if !hitJP && !hitHOF {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		meta, err := m.loadLaneMeta(ctx)
		if err != nil || meta == nil {
			fmt.Printf("[lanes] after-assignment meta load failed: %v\n", err)
			return
		}
		if hitJP {
			m.completeLaneIfDone(ctx, LaneJP, meta.JPCycle, meta.JPStart, draftNum)
		}
		if hitHOF {
			m.completeLaneIfDone(ctx, LaneHOF, meta.HOFCycle, meta.HOFStart, draftNum)
		}
	}()
}

// completeLaneIfDone checks whether draftNum completed the lane's current
// cycle and, if so, performs the rollover.
func (m *Manager) completeLaneIfDone(ctx context.Context, lane string, cycle int, startDraft int, draftNum int) {
	doc, err := loadLaneCycle(ctx, m.db, lane, cycle)
	if err != nil || doc == nil || len(doc.Globals) == 0 {
		fmt.Printf("[lanes] complete-check %s cycle %d: doc unavailable (%v)\n", lane, cycle, err)
		return
	}
	// Is draftNum even in this cycle? (stale meta tolerance)
	member := false
	remaining := 0
	for _, g := range doc.Globals {
		if g == draftNum {
			member = true
		}
		if g > draftNum {
			remaining++
		}
	}
	if !member || remaining > 0 {
		return // not this cycle's hit, or cycle not yet complete (more HOF slots ahead)
	}

	// Cycle complete: reveal + advance meta + pre-commit next cycle.
	fmt.Printf("[lanes] %s cycle %d COMPLETE at draft %d — revealing + opening cycle %d\n", lane, cycle, draftNum, cycle+1)
	if err := mergeLaneCycle(ctx, m.db, lane, cycle, map[string]interface{}{"completedAtDraft": draftNum}); err != nil {
		fmt.Printf("[lanes] mark complete failed: %v\n", err)
	}
	m.revealLaneCycle(ctx, lane, cycle)

	nextStart := draftNum + 1
	err = m.db.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		ref := m.db.Collection(laneProofsCollection).Doc(laneMetaDocID)
		snap, err := tx.Get(ref)
		if err != nil {
			return err
		}
		var fresh laneMeta
		if err := snap.DataTo(&fresh); err != nil {
			return err
		}
		if lane == LaneJP {
			if fresh.JPCycle != cycle { // someone already advanced
				return nil
			}
			fresh.JPCycle = cycle + 1
			fresh.JPStart = nextStart
		} else {
			if fresh.HOFCycle != cycle {
				return nil
			}
			fresh.HOFCycle = cycle + 1
			fresh.HOFStart = nextStart
		}
		return tx.Set(ref, &fresh)
	})
	if err != nil {
		fmt.Printf("[lanes] meta advance failed for %s: %v\n", lane, err)
		return
	}
	// Eager next-cycle commit+derive so the very next fill takes the fast path.
	if _, err := m.ensureLaneCycleSlots(ctx, lane, cycle+1, nextStart); err != nil {
		fmt.Printf("[lanes] eager commit %s cycle %d failed (fill path will retry): %v\n", lane, cycle+1, err)
	}
}

// revealLaneCycle posts the completed cycle's salt on-chain. Mirrors
// revealBatchVRFCommit's guards: refuse if chain says unfulfilled; tolerate
// already-revealed.
func (m *Manager) revealLaneCycle(ctx context.Context, lane string, cycle int) {
	key := laneKey(lane, cycle)
	doc, err := loadLaneCycle(ctx, m.db, lane, cycle)
	if err != nil || doc == nil {
		fmt.Printf("[lanes] reveal %s cycle %d: doc unavailable (%v)\n", lane, cycle, err)
		return
	}
	if doc.Status == "revealed" {
		return
	}
	chain, err := m.client.GetBatchVRFCommit(ctx, key)
	if err != nil || !chain.Fulfilled {
		fmt.Printf("[lanes] reveal %s cycle %d: chain not fulfilled (%v) — skipping\n", lane, cycle, err)
		return
	}
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		fmt.Printf("[lanes] reveal %s cycle %d: bad salt\n", lane, cycle)
		return
	}
	var salt32 [32]byte
	copy(salt32[:], saltBytes)
	res, err := m.client.RevealSalt(ctx, key, salt32)
	if err != nil {
		fmt.Printf("[lanes] reveal %s cycle %d tx failed: %v\n", lane, cycle, err)
		return
	}
	_ = mergeLaneCycle(ctx, m.db, lane, cycle, map[string]interface{}{
		"status": "revealed", "revealTxHash": res.TxHash.Hex(), "revealedAt": time.Now().Unix(),
	})
	fmt.Printf("[lanes] revealed %s cycle %d tx=%s\n", lane, cycle, res.TxHash.Hex())
}
