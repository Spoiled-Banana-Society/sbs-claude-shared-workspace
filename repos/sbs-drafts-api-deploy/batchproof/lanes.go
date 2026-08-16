// Rolling reset windows — the lane system that replaces fixed per-100 batches
// from draft `RollingStartDraft` (201) onward. Spec: shared-workspace
// NOTES_FOR_BORIS_2026-07-19_rolling_windows_jackhof.md (v2, Richard-approved).
//
// Two INDEPENDENT lanes, each a rolling 100-draft window:
//   - jp:  1 slot per window. On hit at draft X the window completes and the
//     next window starts at X+1.
//   - hof: 5 distinct slots per window. Completes when the 5th hits.
//
// SEED PROVENANCE (era model, Boris 2026-07-20 — see lane_eras.go): ONE
// on-chain ceremony per lane ERA pre-randomizes EraCyclesPerLane (150)
// consecutive cycles ≈ 10-15k drafts, exactly like the live 10k merkle
// rounds. Every cycle's positions derive from the era's combinedSeed; a
// cycle completion publishes that cycle's positions + Merkle proof against
// the era root (NO per-cycle on-chain tx), and the era's salt is revealed
// on-chain only when its last cycle completes. The retired per-cycle
// commit flow (laneKey bases 1M/2M on the vrf-commit contract) left two
// orphaned on-chain entries (jp/hof cycle 1) — harmless, documented in
// NOTES-FOR-RICHARD.
//
// Derivation tags are the spec's exact byte layout (UNCHANGED):
//
//	tag = "<lane>:<cycle>:<i>"            e.g. "jp:1:0", "hof:3:2"
//	pos = uint64(first 8 bytes BE of HMAC-SHA256(combinedSeed, tag)) % 100
//	collision walk: +1 mod 100, WITHIN the lane's own slots only.
//	global draft number = windowStartDraft + pos
//
// Cross-lane collisions are allowed and meaningful: both lanes landing the same
// draft = JackHOF (dual-type). No cross-lane rule exists at all.
//
// KEEPING THE HOT PATH FAST: cycle rollover is pure Firestore work (derive
// from the already-sealed era seed) — no chain wait at all. The only slow
// ceremony is once per ~10k drafts when a lane opens its next era, and that
// fires eagerly in the background several cycles before it's needed.
package batchproof

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/ethereum/go-ethereum/common"
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

	// Era-model fields (variant era-merkle): which era seeded this cycle and
	// the public proof published at completion. MerkleProof verifies
	// LaneLeafHash(lane, cycle, positions) against the era's on-chain root.
	Era         int      `firestore:"era,omitempty"`
	LeafIndex   int      `firestore:"leafIndex,omitempty"`
	Leaf        string   `firestore:"leaf,omitempty"`
	MerkleProof []string `firestore:"merkleProof,omitempty"`
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
// Era model: positions come from the lane's already-sealed era seed — pure
// Firestore work except when the cycle's era hasn't run its (once per ~10k
// drafts) ceremony yet. Returns the cycle's SORTED global draft ids.
func (m *Manager) ensureLaneCycleSlots(ctx context.Context, lane string, cycle int, startDraft int) ([]int, error) {
	key := laneKey(lane, cycle)
	lock := m.lockFor(key)
	lock.Lock()
	defer lock.Unlock()

	existing, err := loadLaneCycle(ctx, m.db, lane, cycle)
	if err != nil {
		return nil, err
	}

	// Fast path — era-derived already (and startDraft unchanged: a stale doc
	// from a different window start must be re-derived, though by construction
	// rollover writes the doc once with the final start).
	if existing != nil && existing.Variant == LaneVariantEra && len(existing.Globals) > 0 && existing.StartDraft == startDraft {
		return existing.Globals, nil
	}
	// A pre-era (per-cycle vrf-commit) doc that already REVEALED must never be
	// rewritten — history. By deploy order this can't happen for an active
	// cycle (rolling wasn't live before the era migration), so refuse loudly.
	if existing != nil && existing.Variant == VariantVRFCommit && existing.Status == "revealed" {
		return nil, fmt.Errorf("lane %s cycle %d: revealed pre-era doc — refusing to rewrite", lane, cycle)
	}

	era := eraForCycle(cycle)
	eraDoc, err := m.ensureLaneEra(ctx, lane, era)
	if err != nil {
		return nil, fmt.Errorf("ensure era %d: %w", era, err)
	}
	combined, err := eraCombinedSeed(eraDoc)
	if err != nil {
		return nil, err
	}
	positions, err := DeriveLaneSlots(combined, lane, cycle, laneSlotCount(lane))
	if err != nil {
		return nil, fmt.Errorf("derive lane slots: %w", err)
	}
	globals := make([]int, len(positions))
	for i, p := range positions {
		globals[i] = startDraft + p
	}
	sort.Ints(globals)

	doc := &LaneCycleDoc{
		Lane: lane, Cycle: cycle, LaneKey: laneEraKey(lane, era), StartDraft: startDraft,
		Status: "fulfilled", Variant: LaneVariantEra,
		SaltHash: eraDoc.SaltHash, CommitTx: eraDoc.CommitTx,
		RequestedAt: eraDoc.RequestedAt, VRFRequestID: eraDoc.VRFRequestID,
		VRFRandomness: eraDoc.VRFRandomness, FulfilledAt: eraDoc.FulfilledAt,
		Positions: positions, Globals: globals,
		Era: era, LeafIndex: cycle - eraDoc.CycleStart,
	}
	if err := saveLaneCycle(ctx, m.db, doc); err != nil {
		return nil, fmt.Errorf("persist lane cycle doc: %w", err)
	}
	fmt.Printf("[lanes] cycle ready from era: %s cycle %d (era %d, window %d-%d) → globals=%v (hidden until completion)\n",
		lane, cycle, era, startDraft, startDraft+LaneWindow-1, globals)
	_ = key
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
	// SYNCHRONOUS since 2026-08-14: this ran in a fire-and-forget goroutine,
	// which Cloud Run CPU-throttles the moment the fill request returns — the
	// rollover randomly froze (#434, #633, #649) whenever no other request
	// kept the instance hot. Hits are rare (≤6 per 100 fills) and the work is
	// a handful of Firestore ops (the era ceremony case is once per ~10k
	// drafts), so paying it inline on the fill that landed the hit is cheap
	// and GUARANTEES the next window opens before this request completes.
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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

	// Cycle complete: publish this cycle's Merkle proof + advance meta +
	// derive the next cycle from the era seed (no chain work).
	fmt.Printf("[lanes] %s cycle %d COMPLETE at draft %d — publishing proof + opening cycle %d\n", lane, cycle, draftNum, cycle+1)
	if err := mergeLaneCycle(ctx, m.db, lane, cycle, map[string]interface{}{"completedAtDraft": draftNum}); err != nil {
		fmt.Printf("[lanes] mark complete failed: %v\n", err)
	}
	m.publishLaneCycleProof(ctx, lane, cycle)

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
	// Eager next-cycle derive so the very next fill takes the fast path. If
	// cycle+1 crosses into a new era this also runs that era's ceremony now —
	// ~1 min of background chain work, once per ~10k drafts, never blocking a
	// fill (the fill path would wait only if a hit lands during that minute).
	if _, err := m.ensureLaneCycleSlots(ctx, lane, cycle+1, nextStart); err != nil {
		fmt.Printf("[lanes] eager derive %s cycle %d failed (fill path will retry): %v\n", lane, cycle+1, err)
	}
	// Era turnover bookkeeping: completing an era's LAST cycle unlocks the
	// era-end salt reveal — after that anyone can re-derive all 150 cycles.
	if eraForCycle(cycle+1) != eraForCycle(cycle) {
		m.revealLaneEraSalt(ctx, lane, eraForCycle(cycle))
	}
}

// publishLaneCycleProof marks a completed cycle "revealed" by publishing its
// positions' Merkle proof against the era's on-chain root — the era model's
// per-cycle reveal (no transaction needed; the root was committed at era
// open, so the proof is independently checkable the moment it's published).
func (m *Manager) publishLaneCycleProof(ctx context.Context, lane string, cycle int) {
	doc, err := loadLaneCycle(ctx, m.db, lane, cycle)
	if err != nil || doc == nil {
		fmt.Printf("[lanes] publish %s cycle %d: doc unavailable (%v)\n", lane, cycle, err)
		return
	}
	if doc.Status == "revealed" {
		return
	}
	eraDoc, err := loadLaneEra(ctx, m.db, lane, eraForCycle(cycle))
	if err != nil || eraDoc == nil || len(eraDoc.MerkleLeaves) == 0 {
		fmt.Printf("[lanes] publish %s cycle %d: era unavailable (%v)\n", lane, cycle, err)
		return
	}
	leaf, path, err := eraMerkleProof(eraDoc, cycle)
	if err != nil {
		fmt.Printf("[lanes] publish %s cycle %d: proof build failed: %v\n", lane, cycle, err)
		return
	}
	// Self-check before publishing — a proof that doesn't verify against the
	// stored root means corrupted era data and needs a human.
	if eraDoc.MerkleRoot != "" && !VerifyMerkleProof(leaf, path, common.HexToHash(eraDoc.MerkleRoot)) {
		fmt.Printf("[lanes] publish %s cycle %d: SELF-CHECK FAILED against era root — not publishing\n", lane, cycle)
		return
	}
	proofHex := make([]string, len(path))
	for i, h := range path {
		proofHex[i] = h.Hex()
	}
	_ = mergeLaneCycle(ctx, m.db, lane, cycle, map[string]interface{}{
		"status": "revealed", "revealedAt": time.Now().Unix(),
		"leaf": leaf.Hex(), "merkleProof": proofHex,
	})
	fmt.Printf("[lanes] published proof: %s cycle %d leaf=%s (era %d root on-chain)\n", lane, cycle, leaf.Hex(), eraDoc.Era)
}
