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
	client  *Client
	db      *firestore.Client
	variant string // "commit-reveal" (default) or "vrf"

	mu          sync.Mutex
	inFlight    map[int]*sync.Mutex // per-batch lock
	disabled    bool                // true when client is nil (graceful no-op)
	disabledMsg string
}

// NewManager wires a Manager. If client is nil (e.g., contract address
// not yet on file), the Manager returns gracefully from every public
// method — the existing draft fill flow continues unchanged. Pass
// `disabledMsg` to surface the reason in logs. `variant` selects the
// on-chain flow: "" or "commit-reveal" for legacy, "vrf" for Chainlink VRF.
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

	switch m.variant {
	case VariantVRFCommit:
		return m.ensureBatchHasVRFCommitSlots(ctx, batchNumber)
	case VariantVRF:
		return m.ensureBatchHasVRFSlots(ctx, batchNumber)
	default:
		return m.ensureBatchCommitReveal(ctx, batchNumber)
	}
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

	switch m.variant {
	case VariantVRF:
		// VRF auto-reveals via the coordinator's rawFulfillRandomWords
		// callback. EnsureBatchCommitted already polls for fulfillment
		// and writes status="fulfilled", so there's nothing to do here.
		return nil
	case VariantVRFCommit:
		return m.revealBatchVRFCommit(ctx, batchNumber)
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
)
