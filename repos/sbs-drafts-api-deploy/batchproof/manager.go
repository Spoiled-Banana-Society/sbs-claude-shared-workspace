package batchproof

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
)

// Manager is the high-level façade the rest of the Go API calls. It owns
// the on-chain client + Firestore handle and exposes idempotent operations
// for the two batch lifecycle events that matter:
//
//   - EnsureBatchCommitted: called BEFORE the first draft of a batch
//     fills. Generates seed, commits hash on-chain, derives & publishes
//     slots, persists batch_proofs/{N}. Returns the global draft numbers
//     to populate DraftLeagueTracker.HofLeagueIds / .JackpotLeagueIds.
//   - RevealBatch: called AFTER the last draft of a batch fills. Reveals
//     the seed on-chain so anyone can verify.
//
// Both are best-effort: if the on-chain step fails (RPC down, gas spike,
// transient revert), the Manager logs and returns; the existing draft
// flow continues. Subsequent calls re-attempt because state is reconciled
// from Firestore + chain on every entry.
//
// Concurrency: a process-local mutex serializes EnsureBatchCommitted /
// RevealBatch per-batch so two simultaneous fills can't double-commit.
// Cross-process protection comes from the on-chain "already committed"
// revert and the Firestore status field.
type Manager struct {
	client       *Client // legacy commit-reveal / vrf / vrf-commit contract
	merkleClient *Client // vrf-commit-merkle contract (nil if not deployed)
	db           *firestore.Client
	variant      string // "commit-reveal" (default), "vrf", "vrf-commit", "vrf-commit-merkle"

	mu          sync.Mutex
	inFlight    map[int]*sync.Mutex // per-batch lock
	disabled    bool                // true when client is nil (graceful no-op)
	disabledMsg string
}

// NewManager wires a Manager. If client is nil (e.g., contract address
// not yet on file), the Manager returns gracefully from every public
// method — the existing draft fill flow continues unchanged. Pass
// `disabledMsg` to surface the reason in logs. `variant` selects the
// on-chain flow: "" or "commit-reveal" for legacy, "vrf", "vrf-commit",
// or "vrf-commit-merkle". The Merkle variant additionally requires
// merkleClient; if variant=vrf-commit-merkle and merkleClient is nil,
// the Manager runs in a degraded mode (errors on EnsureBatchCommitted).
func NewManager(client *Client, db *firestore.Client, variant string, disabledMsg string) *Manager {
	if variant == "" {
		variant = VariantCommitReveal
	}
	m := &Manager{
		client:      client,
		db:          db,
		variant:     variant,
		inFlight:    make(map[int]*sync.Mutex),
		disabled:    client == nil,
		disabledMsg: disabledMsg,
	}
	return m
}

// SetMerkleClient attaches the Merkle-variant contract client. Called
// from main.go after both contracts are loaded. Optional — if not set,
// the vrf-commit-merkle variant is unavailable and routing errors will
// fire if it's somehow selected via Firestore config.
// SetDb swaps the manager's Firestore client. Called by the utils layer's
// client recycler: the manager captures utils.Db.Client ONCE at boot, so when
// the recycler replaced (and closed) that client, every lane/batch read died
// forever with "the client connection is closing" — the root cause of the
// JP #434/#633 and HOF #649 rollover failures (4 incidents, Aug 3-14 2026).
// Plain pointer swap, same synchronization model as utils.Db.Client itself.
func (m *Manager) SetDb(db *firestore.Client) {
	m.db = db
}

func (m *Manager) SetMerkleClient(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.merkleClient = client
}

// MerkleClient returns the configured Merkle-variant client (or nil
// if not configured). Useful for admin tooling and observability.
func (m *Manager) MerkleClient() *Client {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.merkleClient
}

// PreOpenNextMerkleRound is an admin/staging helper that explicitly
// drives the next merkle round through the open → fulfilled →
// merkleCommitted state machine, BEFORE any draft fills triggers it
// via the natural batch boundary path. Useful for:
//   - Bootstrapping round 1 on first deploy (so the very first draft of
//     the variant doesn't pay the ~30s VRF latency)
//   - Pre-opening subsequent rounds proactively
//
// firstBatchNumber: the legacy batch number this round will eventually
//   start at. Pass 0 as a sentinel meaning "set on first ensureBatch
//   call that uses this round" — the round-state pointer pre-allocates
//   the round in either case.
//
// Idempotent. If the round already exists (any status), no-ops.
// Returns the round number that was either opened or already exists.
func (m *Manager) PreOpenNextMerkleRound(ctx context.Context, firstBatchNumber int) (int, error) {
	if m.disabled {
		return 0, fmt.Errorf("batchproof disabled: %s", m.disabledMsg)
	}
	if m.variant != VariantVRFCommitMerkle {
		return 0, fmt.Errorf("PreOpenNextMerkleRound only valid for vrf-commit-merkle variant, got %q", m.variant)
	}
	if m.merkleClient == nil {
		return 0, ErrMerkleClientNotConfigured
	}

	// Determine the next round number. If no state exists, it's round 1.
	// Otherwise it's currentRoundNumber+1 if current is full, or
	// currentRoundNumber if current isn't fulfilled yet (in-flight).
	state, err := LoadMerkleRoundState(ctx, m.db)
	if err != nil {
		return 0, fmt.Errorf("load merkle round state: %w", err)
	}

	var roundNumber int
	if state == nil {
		// Pre-bootstrap. This is round 1. Reserve it in state with
		// NextBatchIndexInRound=0 — the first batch boundary will consume index 0.
		roundNumber = 1
		newState := &MerkleRoundState{CurrentRoundNumber: 1, NextBatchIndexInRound: 0}
		if err := SaveMerkleRoundState(ctx, m.db, newState); err != nil {
			return 0, fmt.Errorf("init merkle round state: %w", err)
		}
	} else if state.NextBatchIndexInRound >= MerkleWindowCount {
		// Current round full — bump to next.
		roundNumber = state.CurrentRoundNumber + 1
		newState := &MerkleRoundState{CurrentRoundNumber: roundNumber, NextBatchIndexInRound: 0}
		if err := SaveMerkleRoundState(ctx, m.db, newState); err != nil {
			return 0, fmt.Errorf("advance merkle round state: %w", err)
		}
	} else {
		// Current round is in progress and not full. Pre-open the round
		// AFTER it (so it's ready by the time the current round fills).
		roundNumber = state.CurrentRoundNumber + 1
	}

	lock := m.lockFor(-1 * roundNumber) // negative key so it doesn't collide with batch locks
	lock.Lock()
	defer lock.Unlock()

	existing, err := LoadMerkleRound(ctx, m.db, roundNumber)
	if err != nil {
		return 0, fmt.Errorf("load merkle round: %w", err)
	}
	if existing != nil && (existing.Status == "merkleCommitted" || existing.Status == "revealed") {
		// Already pre-opened and committed — nothing to do.
		return roundNumber, nil
	}

	// Cold-start (or finish in-flight) the round. ensureRoundCommitted is
	// reused for all the lifecycle transitions.
	if _, err := m.ensureRoundCommitted(ctx, roundNumber, firstBatchNumber, existing == nil); err != nil {
		return 0, fmt.Errorf("ensure round %d committed: %w", roundNumber, err)
	}
	return roundNumber, nil
}

// Variant returns the configured contract variant.
func (m *Manager) Variant() string { return m.variant }

// Disabled reports whether the manager is operating in graceful no-op
// mode. Callers can log this once at startup so the operational state is
// observable.
func (m *Manager) Disabled() (bool, string) {
	return m.disabled, m.disabledMsg
}

// EnsureBatchCommitted is the workhorse. Idempotent.
//
// 1. If batch_proofs/{batchNumber} already has status >= "committed" and
//    on-chain getCommit confirms, returns the persisted slot positions.
// 2. Otherwise: generates seed, runs commit() then publishSlots(), writes
//    Firestore, returns the derived globalDraftNumbers for HofLeagueIds /
//    JackpotLeagueIds.
//
// Returns (jackpotGlobals, hofGlobals, error). Both slices use 1-indexed
// global draft numbers (matches DraftLeagueTracker's existing convention).
//
// On any RPC or contract error, returns (nil, nil, err). Caller should
// log + skip — the draft flow keeps working without proofs and we'll try
// again on the next batch boundary.
func (m *Manager) EnsureBatchCommitted(ctx context.Context, batchNumber int) ([]int, []int, error) {
	if m.disabled {
		return nil, nil, fmt.Errorf("batchproof disabled: %s", m.disabledMsg)
	}
	if batchNumber < 1 {
		return nil, nil, fmt.Errorf("batch number must be >= 1, got %d", batchNumber)
	}

	lock := m.lockFor(batchNumber)
	lock.Lock()
	defer lock.Unlock()

	// Route by the batch's EXISTING variant when present, falling back to
	// the manager's current variant for fresh batches. This preserves
	// in-flight batches across config flips — e.g. flipping the manager
	// from vrf-commit to vrf-commit-merkle mid-batch does NOT re-derive
	// the in-flight batch's slot positions. Only NEW batches use the
	// new variant. Prevents conflicting docs + draft-type mismatches.
	variant := m.batchVariantOrDefault(ctx, batchNumber)

	switch variant {
	case VariantVRFCommitMerkle:
		return m.ensureBatchHasMerkleSlots(ctx, batchNumber)
	case VariantVRFCommit:
		return m.ensureBatchHasVRFCommitSlots(ctx, batchNumber)
	case VariantVRF:
		return m.ensureBatchHasVRFSlots(ctx, batchNumber)
	default:
		return m.ensureBatchCommitReveal(ctx, batchNumber)
	}
}

// batchVariantOrDefault returns the variant that should drive batchN's
// lifecycle. Reads batch_proofs/{batchN}.variant if present (so in-flight
// batches keep their original variant across config flips), otherwise
// returns m.variant.
func (m *Manager) batchVariantOrDefault(ctx context.Context, batchNumber int) string {
	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err == nil && existing != nil && existing.Variant != "" {
		return existing.Variant
	}
	return m.variant
}

// ensureBatchCommitReveal is the legacy commit/reveal flow.
func (m *Manager) ensureBatchCommitReveal(ctx context.Context, batchNumber int) ([]int, []int, error) {
	// Step 1: check Firestore. If we already committed, just return the
	// stored positions.
	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("load proof: %w", err)
	}
	if existing != nil && existing.Status != "" && len(existing.JackpotPositions) > 0 {
		jp := PositionsToGlobalDraftNumbers(existing.JackpotPositions, batchNumber)
		hof := PositionsToGlobalDraftNumbers(existing.HofPositions, batchNumber)
		return jp, hof, nil
	}

	// Step 2: cross-check on-chain. Belt-and-suspenders for the case where
	// we crashed between commit() and Firestore write. The contract will
	// reject a second commit, so we'd otherwise lose the seed forever.
	chain, err := m.client.GetCommit(ctx, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("getCommit: %w", err)
	}
	if chain.Committed {
		// On-chain is committed but Firestore isn't. We don't have the seed
		// (it's still off-chain only) so we can't rebuild the doc. Surface
		// loudly — operator must paste the seed from logs into Firestore by
		// hand. This should never happen under normal flow.
		return nil, nil, fmt.Errorf(
			"on-chain commit exists for batch %d but Firestore proof missing — manual recovery required",
			batchNumber,
		)
	}

	// Step 3: fresh batch — generate seed, derive slots, commit hash on-chain.
	//
	// We do NOT call publishSlots() on-chain. Doing so would expose the
	// jackpot/HOF positions to anyone reading the contract — users could
	// then time their entries to land in those exact draft slots. The
	// hash alone is enough to prove "we committed BEFORE any drafts in
	// this batch filled, and the seed reveal at batch close locks us
	// into a single specific outcome." Slot positions stay private in
	// Firestore (Go API uses them to mark drafts as they fill); they
	// become publicly recomputable only after Reveal exposes the seed.
	seed, err := GenerateSeed()
	if err != nil {
		return nil, nil, fmt.Errorf("generate seed: %w", err)
	}
	slots, err := DeriveBatchSlots(seed, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("derive slots: %w", err)
	}
	seedHash := SeedHash(seed)

	commitRes, err := m.client.Commit(ctx, batchNumber, seedHash)
	if err != nil {
		return nil, nil, fmt.Errorf("on-chain commit: %w", err)
	}

	// Step 4: persist privately. Frontend's /api/batches/[N]/proof gates
	// position fields on status='revealed' so the public-facing API
	// doesn't leak them before the seed is on-chain either.
	doc := &ProofDoc{
		BatchNumber:      batchNumber,
		Status:           "committed",
		Variant:          VariantCommitReveal,
		SeedHash:         "0x" + hex.EncodeToString(seedHash.Bytes()),
		CommitTxHash:     commitRes.TxHash.Hex(),
		CommitBlock:      int64(commitRes.BlockNumber),
		CommittedAt:      time.Now().Unix(),
		ServerSeed:       "0x" + hex.EncodeToString(seed),
		JackpotPositions: []int{slots.JackpotPosition},
		HofPositions:     append([]int(nil), slots.HofPositions...),
	}
	if err := SaveProof(ctx, m.db, doc); err != nil {
		// Chain succeeded, persistence failed. This is the bad case but
		// the seed is also in commit logs (TxHash) and the chain has the
		// hash + slots, so reveal is still possible. Surface loudly.
		return nil, nil, fmt.Errorf("persist proof: %w (commit tx %s, seed %x)",
			err, commitRes.TxHash.Hex(), seed)
	}

	jp := PositionsToGlobalDraftNumbers([]int{slots.JackpotPosition}, batchNumber)
	hof := PositionsToGlobalDraftNumbers(slots.HofPositions, batchNumber)
	return jp, hof, nil
}

// RevealBatch posts the seed for batchNumber on-chain. Idempotent:
// returns nil if the batch is already revealed. For VRF batches this is
// a no-op — the Chainlink coordinator publishes the randomness via its
// callback, so there's nothing for us to reveal.
func (m *Manager) RevealBatch(ctx context.Context, batchNumber int) error {
	if m.disabled {
		return fmt.Errorf("batchproof disabled: %s", m.disabledMsg)
	}
	if batchNumber < 1 {
		return fmt.Errorf("batch number must be >= 1, got %d", batchNumber)
	}

	// Same per-batch variant routing as EnsureBatchCommitted — reveal
	// uses the variant the batch was OPENED under, not the manager's
	// current variant. Otherwise a config flip mid-batch would call the
	// wrong reveal path (e.g. trying revealSalt on the merkle contract
	// for a batch that lives on the vrf-commit contract).
	variant := m.batchVariantOrDefault(ctx, batchNumber)
	switch variant {
	case VariantVRF:
		// VRF auto-reveals via the coordinator's rawFulfillRandomWords
		// callback. EnsureBatchCommitted already polls for fulfillment
		// and writes status="fulfilled", so there's nothing to do here.
		return nil
	case VariantVRFCommit:
		return m.revealBatchVRFCommit(ctx, batchNumber)
	case VariantVRFCommitMerkle:
		return m.revealBatchMerkle(ctx, batchNumber)
	}

	lock := m.lockFor(batchNumber)
	lock.Lock()
	defer lock.Unlock()

	doc, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return fmt.Errorf("load proof: %w", err)
	}
	if doc == nil {
		return fmt.Errorf("no proof on file for batch %d — can't reveal", batchNumber)
	}
	if doc.Status == "revealed" {
		return nil
	}
	if doc.ServerSeed == "" {
		return fmt.Errorf("proof for batch %d has no stored seed", batchNumber)
	}

	chain, err := m.client.GetCommit(ctx, batchNumber)
	if err != nil {
		return fmt.Errorf("getCommit: %w", err)
	}
	if !chain.Committed {
		return fmt.Errorf("chain says batch %d not committed; refusing reveal", batchNumber)
	}
	if chain.Revealed {
		// Reconcile Firestore.
		err := MergeProof(ctx, m.db, batchNumber, map[string]interface{}{
			"status":     "revealed",
			"revealedAt": int64(chain.RevealedAt),
		})
		return err
	}

	seedBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSeed, "0x"))
	if err != nil || len(seedBytes) != 32 {
		return fmt.Errorf("invalid stored seed for batch %d: %w", batchNumber, err)
	}

	res, err := m.client.Reveal(ctx, batchNumber, seedBytes)
	if err != nil {
		return fmt.Errorf("on-chain reveal: %w", err)
	}

	return MergeProof(ctx, m.db, batchNumber, map[string]interface{}{
		"status":       "revealed",
		"revealTxHash": res.TxHash.Hex(),
		"revealBlock":  int64(res.BlockNumber),
		"revealedAt":   time.Now().Unix(),
	})
}

// ensureBatchHasVRFSlots is the VRF flow analogue of
// ensureBatchCommitReveal. Idempotent. Returns the global draft numbers
// for jackpot + HOF positions.
//
// State transitions: "" → "requested" → "fulfilled".
//   - "fulfilled" with positions: return them.
//   - "requested": poll WaitForVRFFulfillment, then derive + persist.
//   - missing: submit requestRandomness, persist, then poll + derive.
//
// Pre-request optimization (PreRequestNextBatchRandomness called at the
// END of batch N for batch N+1) means the common case at the START of
// batch N+1 is "already fulfilled" — this method just reads back the
// randomness and derives slots without waiting.
func (m *Manager) ensureBatchHasVRFSlots(ctx context.Context, batchNumber int) ([]int, []int, error) {
	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("load proof: %w", err)
	}

	// Fast path — already fulfilled and slots already derived.
	if existing != nil && existing.Status == "fulfilled" && len(existing.JackpotPositions) > 0 {
		jp := PositionsToGlobalDraftNumbers(existing.JackpotPositions, batchNumber)
		hof := PositionsToGlobalDraftNumbers(existing.HofPositions, batchNumber)
		return jp, hof, nil
	}

	// Mid-flight — request already submitted (likely via pre-request),
	// just need to wait for fulfillment + derive.
	if existing != nil && existing.Status == "requested" {
		state, err := m.client.WaitForVRFFulfillment(ctx, batchNumber, 5*time.Second, 5*time.Minute)
		if err != nil {
			return nil, nil, fmt.Errorf("wait fulfillment: %w", err)
		}
		return m.deriveAndPersistVRFSlots(ctx, batchNumber, state)
	}

	// Cold start — no request yet. Submit one synchronously (the first
	// draft of batch N+1 fills will pay the 30-60s VRF latency, which is
	// why PreRequestNextBatchRandomness exists).
	res, err := m.client.RequestRandomness(ctx, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("requestRandomness: %w", err)
	}

	// Read the requestId from on-chain state (the contract stores it
	// before the tx returns).
	chainState, _ := m.client.GetBatchVRF(ctx, batchNumber)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}

	doc := &ProofDoc{
		BatchNumber:      batchNumber,
		Status:           "requested",
		Variant:          VariantVRF,
		VRFRequestID:     requestID,
		VRFRequestTxHash: res.TxHash.Hex(),
		VRFRequestBlock:  int64(res.BlockNumber),
		VRFRequestedAt:   time.Now().Unix(),
	}
	if err := SaveProof(ctx, m.db, doc); err != nil {
		return nil, nil, fmt.Errorf("persist requested doc: %w", err)
	}

	state, err := m.client.WaitForVRFFulfillment(ctx, batchNumber, 5*time.Second, 5*time.Minute)
	if err != nil {
		return nil, nil, fmt.Errorf("wait fulfillment: %w", err)
	}
	return m.deriveAndPersistVRFSlots(ctx, batchNumber, state)
}

// deriveAndPersistVRFSlots converts on-chain VRF randomness into batch
// slots and merges the result into Firestore.
func (m *Manager) deriveAndPersistVRFSlots(ctx context.Context, batchNumber int, state VRFBatchState) ([]int, []int, error) {
	seed := state.RandomnessSeed()
	if len(seed) != 32 {
		return nil, nil, fmt.Errorf("VRF returned %d-byte seed, expected 32", len(seed))
	}
	slots, err := DeriveBatchSlots(seed, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("derive slots from VRF seed: %w", err)
	}

	updates := map[string]interface{}{
		"status":           "fulfilled",
		"variant":          VariantVRF,
		"vrfRandomness":    "0x" + hex.EncodeToString(seed),
		"vrfFulfilledAt":   int64(state.FulfilledAt),
		"jackpotPositions": []int{slots.JackpotPosition},
		"hofPositions":     append([]int(nil), slots.HofPositions...),
	}
	if err := MergeProof(ctx, m.db, batchNumber, updates); err != nil {
		return nil, nil, fmt.Errorf("merge fulfillment: %w", err)
	}

	jp := PositionsToGlobalDraftNumbers([]int{slots.JackpotPosition}, batchNumber)
	hof := PositionsToGlobalDraftNumbers(slots.HofPositions, batchNumber)
	return jp, hof, nil
}

// PreRequestNextBatchRandomness submits a Chainlink VRF request for
// `batchNumber` ahead of any draft in that batch filling. Intended to be
// called at the end of the previous batch (positionInBatch == 99) so the
// 30-60s coordinator latency is absorbed before batch N+1 starts.
//
// Idempotent: returns nil immediately if Firestore already has a doc for
// this batch (status="requested" or "fulfilled"). No-op for legacy
// commit-reveal variant.
func (m *Manager) PreRequestNextBatchRandomness(ctx context.Context, batchNumber int) error {
	if m.disabled {
		return nil
	}
	if batchNumber < 1 {
		return fmt.Errorf("batch number must be >= 1, got %d", batchNumber)
	}

	switch m.variant {
	case VariantVRF:
		return m.preRequestVRF(ctx, batchNumber)
	case VariantVRFCommit:
		return m.preRequestVRFCommit(ctx, batchNumber)
	case VariantVRFCommitMerkle:
		return m.preRequestMerkle(ctx, batchNumber)
	default:
		return nil
	}
}

func (m *Manager) preRequestVRF(ctx context.Context, batchNumber int) error {
	lock := m.lockFor(batchNumber)
	lock.Lock()
	defer lock.Unlock()

	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return fmt.Errorf("load proof: %w", err)
	}
	if existing != nil && existing.Status != "" {
		return nil
	}

	res, err := m.client.RequestRandomness(ctx, batchNumber)
	if err != nil {
		return fmt.Errorf("requestRandomness: %w", err)
	}

	chainState, _ := m.client.GetBatchVRF(ctx, batchNumber)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}

	doc := &ProofDoc{
		BatchNumber:      batchNumber,
		Status:           "requested",
		Variant:          VariantVRF,
		VRFRequestID:     requestID,
		VRFRequestTxHash: res.TxHash.Hex(),
		VRFRequestBlock:  int64(res.BlockNumber),
		VRFRequestedAt:   time.Now().Unix(),
	}
	return SaveProof(ctx, m.db, doc)
}

// preRequestVRFCommit submits requestRandomnessAndCommit on the hybrid
// contract. We pre-generate a random salt off-chain, hash it, and commit
// the hash atomically with the VRF request. The salt is persisted
// privately in Firestore (will be revealed at end of batch).
func (m *Manager) preRequestVRFCommit(ctx context.Context, batchNumber int) error {
	lock := m.lockFor(batchNumber)
	lock.Lock()
	defer lock.Unlock()

	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return fmt.Errorf("load proof: %w", err)
	}
	if existing != nil && existing.Status != "" {
		return nil
	}

	saltBytes, err := GenerateSeed()
	if err != nil {
		return fmt.Errorf("generate salt: %w", err)
	}
	saltHash := SeedHash(saltBytes)

	res, err := m.client.RequestRandomnessAndCommit(ctx, batchNumber, saltHash)
	if err != nil {
		return fmt.Errorf("requestRandomnessAndCommit: %w", err)
	}

	chainState, _ := m.client.GetBatchVRFCommit(ctx, batchNumber)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}

	doc := &ProofDoc{
		BatchNumber:      batchNumber,
		Status:           "requested",
		Variant:          VariantVRFCommit,
		VRFRequestID:     requestID,
		VRFRequestTxHash: res.TxHash.Hex(),
		VRFRequestBlock:  int64(res.BlockNumber),
		VRFRequestedAt:   time.Now().Unix(),
		SaltHash:         "0x" + hex.EncodeToString(saltHash.Bytes()),
		ServerSalt:       "0x" + hex.EncodeToString(saltBytes),
		CommitTxHashVRF:  res.TxHash.Hex(),
	}
	if err := SaveProof(ctx, m.db, doc); err != nil {
		return err
	}

	// Eager derivation: don't wait until the first draft of this batch
	// fills to compute slot positions. Spawn a goroutine that polls VRF
	// fulfillment in the background and writes the derived positions to
	// Firestore as soon as Chainlink delivers (~10s typical). By the
	// time draft #(N*100+1) fills, slots are already in Firestore and
	// the boundary code goes through the fast path.
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if _, _, err := m.ensureBatchHasVRFCommitSlots(bgCtx, batchNumber); err != nil {
			fmt.Printf("[batchproof] eager derive batch %d failed: %v\n", batchNumber, err)
		} else {
			fmt.Printf("[batchproof] eager derived batch %d slots\n", batchNumber)
		}
	}()
	return nil
}

// ensureBatchHasVRFCommitSlots is the vrf-commit analogue of
// ensureBatchHasVRFSlots. State transitions: "" → "requested" (commit +
// VRF request submitted) → "fulfilled" (VRF callback fired, slots
// derived privately, salt still hidden from public) → "revealed"
// (RevealBatch posted salt on-chain).
//
// At "fulfilled" the positions are stored in Firestore but the proof API
// must continue gating them on status=='revealed' for vrf-commit.
func (m *Manager) ensureBatchHasVRFCommitSlots(ctx context.Context, batchNumber int) ([]int, []int, error) {
	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("load proof: %w", err)
	}

	// Fast path — randomness already fulfilled and slots derived. Both
	// "fulfilled" and "revealed" are valid here; either way we already
	// have positions.
	if existing != nil && (existing.Status == "fulfilled" || existing.Status == "revealed") && len(existing.JackpotPositions) > 0 {
		jp := PositionsToGlobalDraftNumbers(existing.JackpotPositions, batchNumber)
		hof := PositionsToGlobalDraftNumbers(existing.HofPositions, batchNumber)
		return jp, hof, nil
	}

	// Mid-flight — request already submitted (typically via pre-request).
	// Wait for fulfillment, derive positions, persist with status="fulfilled"
	// (NOT "revealed" — salt stays hidden until end of batch).
	if existing != nil && existing.Status == "requested" {
		state, err := m.client.WaitForVRFCommitFulfillment(ctx, batchNumber, 5*time.Second, 5*time.Minute)
		if err != nil {
			return nil, nil, fmt.Errorf("wait fulfillment: %w", err)
		}
		return m.deriveAndPersistVRFCommitSlots(ctx, batchNumber, state, existing)
	}

	// Cold start — generate salt + hash, submit atomic commit+request,
	// then wait for fulfillment.
	saltBytes, err := GenerateSeed()
	if err != nil {
		return nil, nil, fmt.Errorf("generate salt: %w", err)
	}
	saltHash := SeedHash(saltBytes)

	res, err := m.client.RequestRandomnessAndCommit(ctx, batchNumber, saltHash)
	if err != nil {
		return nil, nil, fmt.Errorf("requestRandomnessAndCommit: %w", err)
	}

	chainState, _ := m.client.GetBatchVRFCommit(ctx, batchNumber)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}

	doc := &ProofDoc{
		BatchNumber:      batchNumber,
		Status:           "requested",
		Variant:          VariantVRFCommit,
		VRFRequestID:     requestID,
		VRFRequestTxHash: res.TxHash.Hex(),
		VRFRequestBlock:  int64(res.BlockNumber),
		VRFRequestedAt:   time.Now().Unix(),
		SaltHash:         "0x" + hex.EncodeToString(saltHash.Bytes()),
		ServerSalt:       "0x" + hex.EncodeToString(saltBytes),
		CommitTxHashVRF:  res.TxHash.Hex(),
	}
	if err := SaveProof(ctx, m.db, doc); err != nil {
		return nil, nil, fmt.Errorf("persist requested doc: %w", err)
	}

	state, err := m.client.WaitForVRFCommitFulfillment(ctx, batchNumber, 5*time.Second, 5*time.Minute)
	if err != nil {
		return nil, nil, fmt.Errorf("wait fulfillment: %w", err)
	}
	return m.deriveAndPersistVRFCommitSlots(ctx, batchNumber, state, doc)
}

// deriveAndPersistVRFCommitSlots reads the salt back from Firestore (it
// must have been stored when the request was submitted), combines with
// the on-chain randomness via CombinedSeed, derives the 6 slot positions,
// and merges into Firestore with status="fulfilled". The salt itself
// stays in Firestore but is gated by the proof API until revealSalt fires.
func (m *Manager) deriveAndPersistVRFCommitSlots(
	ctx context.Context,
	batchNumber int,
	state VRFCommitBatchState,
	doc *ProofDoc,
) ([]int, []int, error) {
	if doc == nil || doc.ServerSalt == "" {
		return nil, nil, fmt.Errorf("vrf-commit: server salt missing for batch %d (was the commit tx skipped?)", batchNumber)
	}
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return nil, nil, fmt.Errorf("vrf-commit: invalid stored salt for batch %d: %w", batchNumber, err)
	}
	randomness := state.RandomnessSeed()
	if len(randomness) != 32 {
		return nil, nil, fmt.Errorf("vrf-commit: VRF returned %d-byte randomness, expected 32", len(randomness))
	}
	combined := CombinedSeed(saltBytes, randomness)
	slots, err := DeriveBatchSlots(combined, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("derive slots from combined seed: %w", err)
	}

	updates := map[string]interface{}{
		"status":           "fulfilled",
		"variant":          VariantVRFCommit,
		"vrfRandomness":    "0x" + hex.EncodeToString(randomness),
		"vrfFulfilledAt":   int64(state.FulfilledAt),
		"jackpotPositions": []int{slots.JackpotPosition},
		"hofPositions":     append([]int(nil), slots.HofPositions...),
	}
	if err := MergeProof(ctx, m.db, batchNumber, updates); err != nil {
		return nil, nil, fmt.Errorf("merge fulfillment: %w", err)
	}

	jp := PositionsToGlobalDraftNumbers([]int{slots.JackpotPosition}, batchNumber)
	hof := PositionsToGlobalDraftNumbers(slots.HofPositions, batchNumber)
	return jp, hof, nil
}

// revealBatchVRFCommit posts the previously-committed salt on-chain at
// the end of the batch, making the full math publicly verifiable.
func (m *Manager) revealBatchVRFCommit(ctx context.Context, batchNumber int) error {
	lock := m.lockFor(batchNumber)
	lock.Lock()
	defer lock.Unlock()

	doc, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return fmt.Errorf("load proof: %w", err)
	}
	if doc == nil {
		return fmt.Errorf("vrf-commit: no proof on file for batch %d — can't reveal", batchNumber)
	}
	if doc.Status == "revealed" {
		return nil
	}
	if doc.ServerSalt == "" {
		return fmt.Errorf("vrf-commit: stored salt missing for batch %d", batchNumber)
	}

	// Belt-and-suspenders: cross-check chain state. If the chain already
	// shows revealed (e.g., a previous attempt landed but Firestore wasn't
	// updated), reconcile Firestore and return.
	chain, err := m.client.GetBatchVRFCommit(ctx, batchNumber)
	if err != nil {
		return fmt.Errorf("getBatch (vrf-commit): %w", err)
	}
	if !chain.Fulfilled {
		return fmt.Errorf("vrf-commit: chain says batch %d not fulfilled; refusing reveal", batchNumber)
	}
	if chain.Revealed {
		return MergeProof(ctx, m.db, batchNumber, map[string]interface{}{
			"status":     "revealed",
			"revealedAt": int64(chain.RevealedAt),
		})
	}

	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return fmt.Errorf("vrf-commit: invalid stored salt for batch %d: %w", batchNumber, err)
	}
	var saltArr [32]byte
	copy(saltArr[:], saltBytes)

	res, err := m.client.RevealSalt(ctx, batchNumber, saltArr)
	if err != nil {
		return fmt.Errorf("revealSalt: %w", err)
	}

	return MergeProof(ctx, m.db, batchNumber, map[string]interface{}{
		"status":           "revealed",
		"revealSaltTxHash": res.TxHash.Hex(),
		"revealedAt":       time.Now().Unix(),
	})
}

func (m *Manager) lockFor(batchNumber int) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.inFlight[batchNumber]; ok {
		return existing
	}
	lock := &sync.Mutex{}
	m.inFlight[batchNumber] = lock
	return lock
}

// Singleton helpers — let the rest of the codebase call into batchproof
// without threading a *Manager through every signature. Initialized once
// in main.go via Set; consumed via Default.

var (
	defaultMu sync.RWMutex
	def       *Manager
)

// Set installs the process-wide manager. Call once at startup.
func Set(m *Manager) {
	defaultMu.Lock()
	defer defaultMu.Unlock()
	def = m
}

// Default returns the process-wide manager, or nil if Set hasn't been
// called yet. Callers MUST nil-check (production code path will rarely
// hit the nil case after main.go boot).
func Default() *Manager {
	defaultMu.RLock()
	defer defaultMu.RUnlock()
	return def
}

// Common errors callers can match against.
var (
	ErrManagerNotInitialized = errors.New("batchproof: manager not initialized — Set was never called")
	ErrMerkleClientNotConfigured = errors.New("batchproof: vrf-commit-merkle variant selected but merkleClient not attached — call SetMerkleClient at startup")
)

// ─── vrf-commit-merkle flow (round-based) ──────────────────────────────
//
// A "merkle round" covers 10,000 drafts (= 100 batches × 100 drafts).
// ONE on-chain ceremony per 10k drafts:
//   - requestRandomnessAndCommit (salt-hash + VRF request)
//   - commitMerkleRoot           (after VRF fulfills; root covers all 10k)
//   - revealSalt                 (at round close)
//
// The per-batch (every 100 drafts) hooks in models/draft-state.go still
// fire. The manager routes them as follows for variant=vrf-commit-merkle:
//
//   - EnsureBatchCommitted(batchN):
//       - If batchN is the FIRST batch of a round (batchIndexInRound == 0):
//           open new round on-chain (salt-hash commit + VRF request).
//           Wait for fulfillment. Pre-compute 10k outcomes. Commit Merkle
//           root on-chain. Persist round doc with status='merkleCommitted'.
//       - For subsequent batches in the round: just look up this batch's
//           1 JP + 5 HOF positions from the round's stored per-window data
//           (no on-chain ops, no compute).
//
//   - PreRequestNextBatchRandomness(batchN+1):
//       - If batchN+1 is the FIRST batch of a NEW round: pre-request the
//           new round's VRF so it's already fulfilled by the time the
//           first draft of that round fills. Otherwise no-op.
//
//   - RevealBatch(batchN):
//       - If batchN is the LAST batch of a round (batchIndexInRound == 99):
//           reveal the round's salt on-chain.
//       - Otherwise no-op.
//
// Outcome derivation: 1/5/94 per 100-draft window. The 10k outcomes are
// computed by running the existing DeriveBatchSlots algorithm 100 times,
// once per window, each with its own subseed = HMAC(combinedSeed, "window:k").
// Distribution constraint identical to legacy.

// ensureBatchHasMerkleSlots routes a per-batch boundary call into the
// round-based merkle flow. Determines which 10k-round this batch belongs
// to, ensures the round is open + Merkle root committed, then returns
// the global draft numbers for this batch's 1 JP + 5 HOF window.
//
// Idempotent. Concurrency: the per-batch lock from EnsureBatchCommitted
// (acquired by caller) serializes round-open work across simultaneous
// fills of the same first-batch-of-round.
func (m *Manager) ensureBatchHasMerkleSlots(ctx context.Context, batchNumber int) ([]int, []int, error) {
	if m.merkleClient == nil {
		return nil, nil, ErrMerkleClientNotConfigured
	}

	// Decide which round this batch belongs to (and whether it's the
	// first batch of a new round, requiring an on-chain ceremony).
	roundNumber, batchIndexInRound, isNewRound, err := m.resolveRoundForBatch(ctx, batchNumber)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve round for batch %d: %w", batchNumber, err)
	}

	// Ensure the round itself is at status=merkleCommitted before we
	// can return per-batch slot positions.
	round, err := m.ensureRoundCommitted(ctx, roundNumber, batchNumber, isNewRound)
	if err != nil {
		return nil, nil, fmt.Errorf("ensure round %d committed: %w", roundNumber, err)
	}

	// Also write a per-batch pointer doc at batch_proofs/{batchN} so the
	// existing /api/batches/{N}/proof endpoint can find this batch via
	// its familiar key. The pointer carries enough fields to render the
	// proof UI without re-reading the round doc, plus a roundNumber link
	// for the per-draft Merkle proof endpoint to dereference.
	jpInWindow := round.JackpotByWindow[batchIndexInRound]
	hofInWindow := make([]int, HofCount)
	base := batchIndexInRound * HofCount
	copy(hofInWindow, round.HofByWindowFlat[base:base+HofCount])
	if err := m.writeBatchPointerDoc(ctx, batchNumber, round, batchIndexInRound, jpInWindow, hofInWindow); err != nil {
		return nil, nil, fmt.Errorf("write batch pointer for %d: %w", batchNumber, err)
	}

	jp := PositionsToGlobalDraftNumbers([]int{jpInWindow}, batchNumber)
	hof := PositionsToGlobalDraftNumbers(hofInWindow, batchNumber)
	return jp, hof, nil
}

// resolveRoundForBatch maps an incoming batchNumber to (roundNumber,
// batchIndexInRound, isNewRound). Atomically advances the round-state
// pointer when a new round needs to open. Idempotent — if the batch
// was previously assigned, returns the existing mapping.
func (m *Manager) resolveRoundForBatch(ctx context.Context, batchNumber int) (int, int, bool, error) {
	// Fast path: if we've already written batch_proofs/{batchN} for this
	// batch, the pointer doc carries the mapping. Avoids racing the
	// round-state advance on a retry.
	existing, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return 0, 0, false, fmt.Errorf("load existing batch pointer: %w", err)
	}
	if existing != nil && existing.MerkleRound > 0 {
		return existing.MerkleRound, existing.MerkleBatchIndexInRound, false, nil
	}

	state, err := LoadMerkleRoundState(ctx, m.db)
	if err != nil {
		return 0, 0, false, fmt.Errorf("load merkle round state: %w", err)
	}

	// Pre-bootstrap: no rounds yet. This batch becomes round 1, index 0.
	if state == nil {
		newState := &MerkleRoundState{CurrentRoundNumber: 1, NextBatchIndexInRound: 1}
		if err := SaveMerkleRoundState(ctx, m.db, newState); err != nil {
			return 0, 0, false, fmt.Errorf("init merkle round state: %w", err)
		}
		return 1, 0, true, nil
	}

	if state.NextBatchIndexInRound >= MerkleWindowCount {
		// Round full — open the next one.
		nextRound := state.CurrentRoundNumber + 1
		newState := &MerkleRoundState{CurrentRoundNumber: nextRound, NextBatchIndexInRound: 1}
		if err := SaveMerkleRoundState(ctx, m.db, newState); err != nil {
			return 0, 0, false, fmt.Errorf("advance merkle round state: %w", err)
		}
		return nextRound, 0, true, nil
	}

	// Continuing within the current round.
	batchIndex := state.NextBatchIndexInRound
	state.NextBatchIndexInRound++
	if err := SaveMerkleRoundState(ctx, m.db, state); err != nil {
		return 0, 0, false, fmt.Errorf("bump merkle round state: %w", err)
	}
	return state.CurrentRoundNumber, batchIndex, false, nil
}

// ensureRoundCommitted drives a merkle round through the state machine
// until it's at "merkleCommitted" (or "revealed"). Idempotent. If the
// round doc doesn't exist yet AND this is a new round, opens it cold:
// salt + VRF request → wait fulfill → build tree → commit root on-chain.
//
// firstBatchNumber is the batchN that opened this round (needed for
// the firstBatchNumber field on the doc).
func (m *Manager) ensureRoundCommitted(
	ctx context.Context,
	roundNumber int,
	firstBatchNumber int,
	isNewRound bool,
) (*MerkleRoundDoc, error) {
	existing, err := LoadMerkleRound(ctx, m.db, roundNumber)
	if err != nil {
		return nil, fmt.Errorf("load merkle round: %w", err)
	}

	// Already committed — fast path.
	if existing != nil && (existing.Status == "merkleCommitted" || existing.Status == "revealed") {
		return existing, nil
	}

	// VRF fulfilled but root not yet committed — finish the pipeline.
	if existing != nil && existing.Status == "fulfilled" && existing.VRFRandomness != "" && existing.ServerSalt != "" {
		return m.commitRoundMerkleRoot(ctx, roundNumber, existing)
	}

	// Request submitted but VRF not yet fulfilled — wait + commit root.
	if existing != nil && existing.Status == "requested" {
		state, err := m.merkleClient.WaitForMerkleCommitFulfillment(ctx, roundNumber, 5*time.Second, 5*time.Minute)
		if err != nil {
			return nil, fmt.Errorf("wait merkle fulfillment: %w", err)
		}
		if err := m.persistRoundFulfilled(ctx, roundNumber, state); err != nil {
			return nil, err
		}
		updated, _ := LoadMerkleRound(ctx, m.db, roundNumber)
		return m.commitRoundMerkleRoot(ctx, roundNumber, updated)
	}

	// Cold start — only valid if this is a new round.
	if !isNewRound {
		return nil, fmt.Errorf("round %d has no doc but isn't flagged as new — inconsistent state", roundNumber)
	}

	saltBytes, err := GenerateSeed()
	if err != nil {
		return nil, fmt.Errorf("generate salt: %w", err)
	}
	saltHash := SeedHash(saltBytes)

	res, err := m.merkleClient.RequestRandomnessAndCommitMerkle(ctx, roundNumber, saltHash)
	if err != nil {
		return nil, fmt.Errorf("merkle requestRandomnessAndCommit: %w", err)
	}

	chainState, _ := m.merkleClient.GetBatchMerkleCommit(ctx, roundNumber)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}

	doc := &MerkleRoundDoc{
		RoundNumber:      roundNumber,
		Status:           "requested",
		FirstBatchNumber: firstBatchNumber,
		SaltHash:         "0x" + hex.EncodeToString(saltHash.Bytes()),
		ServerSalt:       "0x" + hex.EncodeToString(saltBytes),
		VRFRequestID:     requestID,
		VRFRequestTxHash: res.TxHash.Hex(),
		CommitTxHashVRF:  res.TxHash.Hex(),
		OpenedAt:         time.Now().Unix(),
	}
	if err := SaveMerkleRound(ctx, m.db, doc); err != nil {
		return nil, fmt.Errorf("persist requested round: %w", err)
	}

	state, err := m.merkleClient.WaitForMerkleCommitFulfillment(ctx, roundNumber, 5*time.Second, 5*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("wait merkle fulfillment: %w", err)
	}
	if err := m.persistRoundFulfilled(ctx, roundNumber, state); err != nil {
		return nil, err
	}
	updated, _ := LoadMerkleRound(ctx, m.db, roundNumber)
	return m.commitRoundMerkleRoot(ctx, roundNumber, updated)
}

// persistRoundFulfilled merges VRF-fulfilled state into the round doc.
func (m *Manager) persistRoundFulfilled(
	ctx context.Context,
	roundNumber int,
	state MerkleCommitBatchState,
) error {
	randomness := state.RandomnessSeed()
	if len(randomness) != 32 {
		return fmt.Errorf("merkle: VRF returned %d-byte randomness, expected 32", len(randomness))
	}
	updates := map[string]interface{}{
		"status":        "fulfilled",
		"vrfRandomness": "0x" + hex.EncodeToString(randomness),
		"fulfilledAt":   int64(state.FulfilledAt),
	}
	return MergeMerkleRound(ctx, m.db, roundNumber, updates)
}

// commitRoundMerkleRoot reads salt + VRF from the round doc, derives
// 10k outcomes (1 JP + 5 HOF per 100-window), builds the Merkle tree,
// commits the root on-chain, and persists everything back to Firestore.
// After this, the round is at status="merkleCommitted" and any draft
// within the round can be served a per-draft Merkle proof.
func (m *Manager) commitRoundMerkleRoot(
	ctx context.Context,
	roundNumber int,
	doc *MerkleRoundDoc,
) (*MerkleRoundDoc, error) {
	if doc == nil {
		return nil, fmt.Errorf("merkle commit: round doc missing for round %d", roundNumber)
	}
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return nil, fmt.Errorf("merkle commit: invalid stored salt for round %d: %w", roundNumber, err)
	}
	randBytes, err := hex.DecodeString(strings.TrimPrefix(doc.VRFRandomness, "0x"))
	if err != nil || len(randBytes) != 32 {
		return nil, fmt.Errorf("merkle commit: invalid stored VRF randomness for round %d: %w", roundNumber, err)
	}

	combined := CombinedSeed(saltBytes, randBytes)
	tree, outcomes, err := BuildRoundMerkleTree(combined)
	if err != nil {
		return nil, fmt.Errorf("merkle commit: build round tree: %w", err)
	}

	// Idempotency: if on-chain root already committed (we crashed between
	// the tx and the Firestore write), reconcile state instead of double-
	// submitting.
	chain, chainErr := m.merkleClient.GetBatchMerkleCommit(ctx, roundNumber)
	var rootTxHash string
	if chainErr == nil && chain.RootCommitted {
		if chain.MerkleRoot != tree.Root {
			return nil, fmt.Errorf("merkle commit: chain root %s differs from locally-derived %s — refusing to overwrite",
				chain.MerkleRoot.Hex(), tree.Root.Hex())
		}
		rootTxHash = doc.CommitTxHashVRF
	} else {
		res, err := m.merkleClient.CommitMerkleRoot(ctx, roundNumber, tree.Root)
		if err != nil {
			return nil, fmt.Errorf("commitMerkleRoot: %w", err)
		}
		rootTxHash = res.TxHash.Hex()
	}

	leafHexes := make([]string, len(tree.Leaves))
	for i, leaf := range tree.Leaves {
		leafHexes[i] = HashStringToHex(leaf)
	}
	jpByWindow := make([]int, MerkleWindowCount)
	hofByWindowFlat := make([]int, MerkleWindowCount*HofCount)
	for w := 0; w < MerkleWindowCount; w++ {
		jpByWindow[w] = outcomes.Windows[w].JackpotPosition
		for i, p := range outcomes.Windows[w].HofPositions {
			hofByWindowFlat[w*HofCount+i] = p
		}
	}

	updates := map[string]interface{}{
		"status":                "merkleCommitted",
		"merkleRoot":            HashStringToHex(tree.Root),
		"merkleRootTxHash":      rootTxHash,
		"merkleRootCommittedAt": time.Now().Unix(),
		"merkleLeaves":          leafHexes,
		"jackpotByWindow":       jpByWindow,
		"hofByWindowFlat":       hofByWindowFlat,
		"hofByWindowSize":       HofCount,
	}
	if err := MergeMerkleRound(ctx, m.db, roundNumber, updates); err != nil {
		return nil, fmt.Errorf("merge merkle commit: %w", err)
	}
	updated, _ := LoadMerkleRound(ctx, m.db, roundNumber)
	return updated, nil
}

// writeBatchPointerDoc writes batch_proofs/{batchN} for a merkle-variant
// batch. The pointer carries enough fields for the existing /api/batches
// proof endpoint to render the batch's UI, plus MerkleRound +
// MerkleBatchIndexInRound for dereferencing into the round doc.
func (m *Manager) writeBatchPointerDoc(
	ctx context.Context,
	batchNumber int,
	round *MerkleRoundDoc,
	batchIndexInRound int,
	jackpotPos int,
	hofPositions []int,
) error {
	doc := &ProofDoc{
		BatchNumber:             batchNumber,
		Status:                  round.Status,
		Variant:                 VariantVRFCommitMerkle,
		SaltHash:                round.SaltHash,
		CommitTxHashVRF:         round.CommitTxHashVRF,
		VRFRequestID:            round.VRFRequestID,
		VRFRequestTxHash:        round.VRFRequestTxHash,
		VRFRandomness:           round.VRFRandomness,
		VRFFulfilledAt:          round.FulfilledAt,
		MerkleRoot:              round.MerkleRoot,
		MerkleRootTxHash:        round.MerkleRootTxHash,
		MerkleRootCommittedAt:   round.MerkleRootCommittedAt,
		MerkleRound:             round.RoundNumber,
		MerkleBatchIndexInRound: batchIndexInRound,
		JackpotPositions:        []int{jackpotPos},
		HofPositions:            hofPositions,
	}
	// Status from the round is "merkleCommitted" (or "revealed" later).
	// The batch_proofs status carries the same string.
	return SaveProof(ctx, m.db, doc)
}

// revealBatchMerkle posts the salt for the round when batchNumber is
// the LAST batch in that round (batchIndexInRound == 99). For
// intermediate batches it's a no-op.
func (m *Manager) revealBatchMerkle(ctx context.Context, batchNumber int) error {
	if m.merkleClient == nil {
		return ErrMerkleClientNotConfigured
	}

	pointer, err := LoadProof(ctx, m.db, batchNumber)
	if err != nil {
		return fmt.Errorf("load batch pointer: %w", err)
	}
	if pointer == nil || pointer.MerkleRound == 0 {
		return fmt.Errorf("batch %d has no merkle round pointer — can't reveal", batchNumber)
	}
	if pointer.MerkleBatchIndexInRound != MerkleWindowCount-1 {
		// Not the last batch in the round; reveal happens only at round close.
		return nil
	}

	round, err := LoadMerkleRound(ctx, m.db, pointer.MerkleRound)
	if err != nil {
		return fmt.Errorf("load merkle round: %w", err)
	}
	if round == nil {
		return fmt.Errorf("merkle round %d missing", pointer.MerkleRound)
	}
	if round.Status == "revealed" {
		return nil
	}
	if round.Status != "merkleCommitted" {
		return fmt.Errorf("round %d status=%q, expected merkleCommitted before reveal", round.RoundNumber, round.Status)
	}
	if round.ServerSalt == "" {
		return fmt.Errorf("merkle reveal: no stored salt for round %d", round.RoundNumber)
	}

	saltBytes, err := hex.DecodeString(strings.TrimPrefix(round.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return fmt.Errorf("merkle reveal: invalid stored salt for round %d: %w", round.RoundNumber, err)
	}
	var salt [32]byte
	copy(salt[:], saltBytes)

	res, err := m.merkleClient.RevealSaltMerkle(ctx, round.RoundNumber, salt)
	if err != nil {
		return fmt.Errorf("merkle revealSalt: %w", err)
	}

	now := time.Now().Unix()
	if err := MergeMerkleRound(ctx, m.db, round.RoundNumber, map[string]interface{}{
		"status":           "revealed",
		"revealSaltTxHash": res.TxHash.Hex(),
		"revealedAt":       now,
	}); err != nil {
		return fmt.Errorf("merge round reveal: %w", err)
	}

	// Propagate "revealed" status to all 100 batch pointer docs in this
	// round so the existing proof endpoint surfaces the right state. Best-
	// effort — if a particular pointer doc doesn't exist (only batches
	// that actually filled have one), skip silently.
	for b := round.FirstBatchNumber; b < round.FirstBatchNumber+MerkleWindowCount; b++ {
		_ = MergeProof(ctx, m.db, b, map[string]interface{}{
			"status":           "revealed",
			"revealSaltTxHash": res.TxHash.Hex(),
			"revealedAt":       now,
			"serverSalt":       round.ServerSalt,
		})
	}
	return nil
}

// preRequestMerkle pre-opens the NEXT round on-chain when batchNumber
// is going to be the first batch of that round. Lets the on-chain
// commit + VRF latency be absorbed before the first draft of the round
// actually fills. For intermediate batches, no-op.
func (m *Manager) preRequestMerkle(ctx context.Context, batchNumber int) error {
	if m.merkleClient == nil {
		return nil
	}

	// Will this batch be the first of a new round? Inspect round state.
	state, err := LoadMerkleRoundState(ctx, m.db)
	if err != nil {
		return fmt.Errorf("load merkle round state: %w", err)
	}
	if state == nil {
		// Pre-bootstrap; nothing to pre-open. The very first ensureRoundCommitted
		// call will cold-start round 1.
		return nil
	}
	// If we're going to roll into a new round at this batch (state says
	// the current round is full), pre-open round N+1.
	if state.NextBatchIndexInRound < MerkleWindowCount {
		return nil
	}

	nextRoundNumber := state.CurrentRoundNumber + 1
	existing, err := LoadMerkleRound(ctx, m.db, nextRoundNumber)
	if err != nil {
		return fmt.Errorf("load next round: %w", err)
	}
	if existing != nil {
		return nil // already pre-requested
	}

	saltBytes, err := GenerateSeed()
	if err != nil {
		return fmt.Errorf("generate salt: %w", err)
	}
	saltHash := SeedHash(saltBytes)

	res, err := m.merkleClient.RequestRandomnessAndCommitMerkle(ctx, nextRoundNumber, saltHash)
	if err != nil {
		return fmt.Errorf("merkle pre-request: %w", err)
	}

	chainState, _ := m.merkleClient.GetBatchMerkleCommit(ctx, nextRoundNumber)
	requestID := ""
	if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
		requestID = chainState.VRFRequestID.String()
	}

	doc := &MerkleRoundDoc{
		RoundNumber:      nextRoundNumber,
		Status:           "requested",
		FirstBatchNumber: batchNumber,
		SaltHash:         "0x" + hex.EncodeToString(saltHash.Bytes()),
		ServerSalt:       "0x" + hex.EncodeToString(saltBytes),
		VRFRequestID:     requestID,
		VRFRequestTxHash: res.TxHash.Hex(),
		CommitTxHashVRF:  res.TxHash.Hex(),
		OpenedAt:         time.Now().Unix(),
	}
	return SaveMerkleRound(ctx, m.db, doc)
}
