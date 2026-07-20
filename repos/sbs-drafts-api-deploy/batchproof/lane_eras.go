// Lane ERAS — one on-chain ceremony pre-randomizes ~10-15k drafts per lane.
//
// Boris's requirement (2026-07-20): the rolling lanes must randomize a long
// horizon in ONE ceremony, exactly like the live 10k merkle rounds — not one
// VRF request per window. Richard's reset-on-hit flow is UNCHANGED (a hit at
// draft X still starts the next window at X+1); only the SEED PROVENANCE
// changes: every future cycle's positions derive from a single era-level
// combinedSeed instead of a per-cycle one.
//
// Per lane era (jp and hof are fully independent, like the lanes themselves):
//   - EraCyclesPerLane consecutive cycles are covered (150). A jp cycle spans
//     at most 100 drafts (expected ~50), a hof cycle at most 100 (expected
//     ~83) → one era ≈ 7.5k-15k drafts. "10k or 12k or 14k, whatever makes
//     sense" — this is that.
//   - ONE ceremony on the SAME BBB4BatchProofMerkle contract the live 10k
//     rounds use (system_config/batchProofMerkle):
//       requestRandomnessAndCommit(eraKey, saltHash)   — seals the salt + VRF
//       commitMerkleRoot(eraKey, root)                 — root over all cycles
//       revealSalt(eraKey, salt)                       — at era END only
//     eraKey = eraKeyBase + eraNumber (jp 3_000_000, hof 4_000_000) — never
//     collides with legacy batches (1..999_999), the retired per-cycle lane
//     keys (1M/2M), or the 10k merkle rounds' numbering on that contract.
//   - Derivation per cycle: DeriveLaneSlots(eraCombinedSeed, lane, cycle, n) —
//     Richard's byte-spec formula, untouched. Cycle numbers are GLOBAL and
//     monotonically increasing across eras, so tags never repeat.
//   - Merkle leaves (one per cycle, leafIndex = cycle - eraCycleStart):
//       leaf = keccak256("<lane>:<cycle>:<p0>[,<p1>...]")
//     positions in DERIVATION order (i = 0..n-1), 0-indexed within the window.
//     Tree = the same sorted-pair keccak tree as the 10k rounds
//     (BuildMerkleTree / VerifyMerkleProof — OpenZeppelin-compatible).
//
// WHY leaves stay server-side until a cycle completes: a leaf's preimage has
// only 100 (jp) / ~75M (hof) possibilities — publishing a leaf early would let
// anyone brute-force the hidden positions. Same trust model as the live 10k
// rounds: only the ROOT is public during play; each completed cycle publishes
// its positions + proof path (independently verifiable against the on-chain
// root); the era-end salt reveal lets anyone re-derive EVERYTHING.
package batchproof

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	// EraCyclesPerLane — windows pre-randomized per ceremony. 150 windows/lane
	// ≈ 7.5k-15k drafts depending on where hits land.
	EraCyclesPerLane = 150

	laneEraKeyBaseJP  = 3_000_000
	laneEraKeyBaseHOF = 4_000_000

	laneErasCollection = "lane_eras"

	// LaneVariantEra marks cycle docs whose positions come from an era seed
	// (vs the retired "vrf-commit" per-cycle flow).
	LaneVariantEra = "era-merkle"
)

func laneEraKey(lane string, era int) int {
	if lane == LaneHOF {
		return laneEraKeyBaseHOF + era
	}
	return laneEraKeyBaseJP + era
}

func laneEraDocID(lane string, era int) string { return fmt.Sprintf("%s-era-%d", lane, era) }

// LaneEraDoc is the Firestore record for one lane's era, at
// lane_eras/{lane}-era-{n}. ServerSalt stays hidden (server-side only) until
// the era's LAST cycle completes; the Merkle root is public from day one.
type LaneEraDoc struct {
	Lane          string   `firestore:"lane"`
	Era           int      `firestore:"era"`
	EraKey        int      `firestore:"eraKey"`
	CycleStart    int      `firestore:"cycleStart"` // first GLOBAL cycle number covered
	CycleEnd      int      `firestore:"cycleEnd"`   // last  GLOBAL cycle number covered (inclusive)
	Status        string   `firestore:"status"`     // requested → rootCommitted → revealed
	Variant       string   `firestore:"variant"`    // always era-merkle
	SaltHash      string   `firestore:"saltHash"`
	ServerSalt    string   `firestore:"serverSalt"` // SECRET until era end
	CommitTx      string   `firestore:"commitTxHash"`
	RequestedAt   int64    `firestore:"vrfRequestedAt"`
	VRFRequestID  string   `firestore:"vrfRequestId,omitempty"`
	VRFRandomness string   `firestore:"vrfRandomness,omitempty"`
	FulfilledAt   int64    `firestore:"vrfFulfilledAt,omitempty"`
	MerkleRoot    string   `firestore:"merkleRoot,omitempty"`
	RootCommitTx  string   `firestore:"rootCommitTxHash,omitempty"`
	MerkleLeaves  []string `firestore:"merkleLeaves,omitempty"` // EraCyclesPerLane hex hashes, leafIndex = cycle - CycleStart
	RevealTx      string   `firestore:"revealTxHash,omitempty"`
	RevealedAt    int64    `firestore:"revealedAt,omitempty"`
}

// LaneLeafHash is the public leaf encoding: keccak256 of the ASCII string
// "<lane>:<cycle>:<p0>[,<p1>...]" with positions in derivation order.
// MUST stay byte-identical to the client verifier.
func LaneLeafHash(lane string, cycle int, positions []int) common.Hash {
	parts := make([]string, len(positions))
	for i, p := range positions {
		parts[i] = fmt.Sprintf("%d", p)
	}
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("%s:%d:%s", lane, cycle, strings.Join(parts, ","))))
}

func loadLaneEra(ctx context.Context, db *firestore.Client, lane string, era int) (*LaneEraDoc, error) {
	snap, err := db.Collection(laneErasCollection).Doc(laneEraDocID(lane, era)).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s/%s: %w", laneErasCollection, laneEraDocID(lane, era), err)
	}
	var doc LaneEraDoc
	if err := snap.DataTo(&doc); err != nil {
		return nil, fmt.Errorf("decode era %s: %w", laneEraDocID(lane, era), err)
	}
	return &doc, nil
}

// eraForCycle returns the era number whose cycle range contains `cycle`,
// given the lane's era 1 starts at cycle `firstCycle` (always 1 today; kept
// explicit so a future re-anchor is a data change, not a code change).
func eraForCycle(cycle int) int {
	if cycle < 1 {
		return 1
	}
	return ((cycle - 1) / EraCyclesPerLane) + 1
}

func eraCycleStart(era int) int { return (era-1)*EraCyclesPerLane + 1 }

// ensureLaneEra guarantees lane_eras/{lane}-era-{n} exists with its Merkle
// root committed on-chain, running the ceremony if needed. Returns the doc.
// Idempotent; serialized by the era's own lock. Requires the merkle-variant
// client (same contract the 10k rounds run on).
func (m *Manager) ensureLaneEra(ctx context.Context, lane string, era int) (*LaneEraDoc, error) {
	if m.merkleClient == nil {
		return nil, ErrMerkleClientNotConfigured
	}
	key := laneEraKey(lane, era)
	lock := m.lockFor(key)
	lock.Lock()
	defer lock.Unlock()

	doc, err := loadLaneEra(ctx, m.db, lane, era)
	if err != nil {
		return nil, err
	}

	// Fast path — ceremony already done.
	if doc != nil && (doc.Status == "rootCommitted" || doc.Status == "revealed") && doc.VRFRandomness != "" {
		return doc, nil
	}

	// Cold start — seal a fresh salt + request VRF in one tx.
	if doc == nil {
		saltBytes, err := GenerateSeed()
		if err != nil {
			return nil, fmt.Errorf("generate era salt: %w", err)
		}
		saltHash := SeedHash(saltBytes)
		res, err := m.merkleClient.RequestRandomnessAndCommitMerkle(ctx, key, saltHash)
		if err != nil {
			return nil, fmt.Errorf("era commit %s era %d: %w", lane, era, err)
		}
		chainState, _ := m.merkleClient.GetBatchMerkleCommit(ctx, key)
		requestID := ""
		if chainState.VRFRequestID != nil && chainState.VRFRequestID.Sign() > 0 {
			requestID = chainState.VRFRequestID.String()
		}
		doc = &LaneEraDoc{
			Lane: lane, Era: era, EraKey: key,
			CycleStart: eraCycleStart(era), CycleEnd: eraCycleStart(era) + EraCyclesPerLane - 1,
			Status: "requested", Variant: LaneVariantEra,
			SaltHash:   "0x" + hex.EncodeToString(saltHash.Bytes()),
			ServerSalt: "0x" + hex.EncodeToString(saltBytes),
			CommitTx:   res.TxHash.Hex(), RequestedAt: time.Now().Unix(),
			VRFRequestID: requestID,
		}
		if _, err := m.db.Collection(laneErasCollection).Doc(laneEraDocID(lane, era)).Set(ctx, doc); err != nil {
			return nil, fmt.Errorf("persist era doc: %w", err)
		}
		fmt.Printf("[lanes] era ceremony opened: %s era %d (cycles %d-%d) key=%d tx=%s\n",
			lane, era, doc.CycleStart, doc.CycleEnd, key, res.TxHash.Hex())
	}

	// Wait for Chainlink, derive every cycle, build + commit the root.
	state, err := m.merkleClient.WaitForMerkleCommitFulfillment(ctx, key, 5*time.Second, 5*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("era %s %d wait fulfillment: %w", lane, era, err)
	}
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return nil, fmt.Errorf("era %s %d: invalid stored salt", lane, era)
	}
	randomness := state.RandomnessSeed()
	if len(randomness) != 32 {
		return nil, fmt.Errorf("era %s %d: VRF returned %d-byte randomness", lane, era, len(randomness))
	}
	combined := CombinedSeed(saltBytes, randomness)

	leaves := make([]common.Hash, EraCyclesPerLane)
	leafHexes := make([]string, EraCyclesPerLane)
	for i := 0; i < EraCyclesPerLane; i++ {
		cycle := doc.CycleStart + i
		positions, err := DeriveLaneSlots(combined, lane, cycle, laneSlotCount(lane))
		if err != nil {
			return nil, fmt.Errorf("era derive %s cycle %d: %w", lane, cycle, err)
		}
		leaves[i] = LaneLeafHash(lane, cycle, positions)
		leafHexes[i] = leaves[i].Hex()
	}
	tree, err := BuildMerkleTree(leaves)
	if err != nil {
		return nil, fmt.Errorf("era %s %d build tree: %w", lane, era, err)
	}

	// Commit the root on-chain unless a prior attempt already did.
	chain, _ := m.merkleClient.GetBatchMerkleCommit(ctx, key)
	rootCommitTx := doc.RootCommitTx
	if chain.RootCommitted {
		if chain.MerkleRoot != tree.Root {
			return nil, fmt.Errorf("era %s %d: computed root %s disagrees with on-chain %s",
				lane, era, tree.Root.Hex(), chain.MerkleRoot.Hex())
		}
	} else {
		res, err := m.merkleClient.CommitMerkleRoot(ctx, key, tree.Root)
		if err != nil {
			return nil, fmt.Errorf("era %s %d commit root: %w", lane, era, err)
		}
		rootCommitTx = res.TxHash.Hex()
	}

	updates := map[string]interface{}{
		"status":           "rootCommitted",
		"vrfRandomness":    "0x" + hex.EncodeToString(randomness),
		"vrfFulfilledAt":   int64(state.FulfilledAt),
		"merkleRoot":       tree.Root.Hex(),
		"rootCommitTxHash": rootCommitTx,
		"merkleLeaves":     leafHexes,
	}
	if _, err := m.db.Collection(laneErasCollection).Doc(laneEraDocID(lane, era)).Set(ctx, updates, firestore.MergeAll); err != nil {
		return nil, fmt.Errorf("era %s %d persist root: %w", lane, era, err)
	}
	fmt.Printf("[lanes] era SEALED: %s era %d — %d cycles pre-randomized, root=%s\n",
		lane, era, EraCyclesPerLane, tree.Root.Hex())

	return loadLaneEra(ctx, m.db, lane, era)
}

// eraCombinedSeed decodes an era doc's salt + randomness into the combined
// derivation seed. Only callable server-side (salt is secret until reveal).
func eraCombinedSeed(doc *LaneEraDoc) ([]byte, error) {
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		return nil, fmt.Errorf("era %s %d: bad salt", doc.Lane, doc.Era)
	}
	randBytes, err := hex.DecodeString(strings.TrimPrefix(doc.VRFRandomness, "0x"))
	if err != nil || len(randBytes) != 32 {
		return nil, fmt.Errorf("era %s %d: bad randomness", doc.Lane, doc.Era)
	}
	return CombinedSeed(saltBytes, randBytes), nil
}

// eraMerkleProof rebuilds the era's tree from stored leaves and returns the
// proof path for cycle's leaf. 150 leaves → trivial compute.
func eraMerkleProof(doc *LaneEraDoc, cycle int) (leaf common.Hash, proof []common.Hash, err error) {
	idx := cycle - doc.CycleStart
	if idx < 0 || idx >= len(doc.MerkleLeaves) {
		return common.Hash{}, nil, fmt.Errorf("cycle %d outside era %s %d", cycle, doc.Lane, doc.Era)
	}
	leaves := make([]common.Hash, len(doc.MerkleLeaves))
	for i, h := range doc.MerkleLeaves {
		leaves[i] = common.HexToHash(h)
	}
	tree, err := BuildMerkleTree(leaves)
	if err != nil {
		return common.Hash{}, nil, err
	}
	path, err := tree.GetMerkleProof(idx)
	if err != nil {
		return common.Hash{}, nil, err
	}
	return leaves[idx], path, nil
}

// revealLaneEraSalt publishes the era's salt on-chain once its LAST cycle has
// completed — after that, anyone can re-derive all 150 cycles and check them
// against the root. Safe: no future cycle depends on this seed anymore.
func (m *Manager) revealLaneEraSalt(ctx context.Context, lane string, era int) {
	if m.merkleClient == nil {
		return
	}
	doc, err := loadLaneEra(ctx, m.db, lane, era)
	if err != nil || doc == nil || doc.Status == "revealed" {
		return
	}
	saltBytes, err := hex.DecodeString(strings.TrimPrefix(doc.ServerSalt, "0x"))
	if err != nil || len(saltBytes) != 32 {
		fmt.Printf("[lanes] era reveal %s %d: bad salt\n", lane, era)
		return
	}
	var salt32 [32]byte
	copy(salt32[:], saltBytes)
	res, err := m.merkleClient.RevealSaltMerkle(ctx, laneEraKey(lane, era), salt32)
	if err != nil {
		fmt.Printf("[lanes] era reveal %s %d tx failed: %v\n", lane, era, err)
		return
	}
	_, _ = m.db.Collection(laneErasCollection).Doc(laneEraDocID(lane, era)).Set(ctx, map[string]interface{}{
		"status": "revealed", "revealTxHash": res.TxHash.Hex(), "revealedAt": time.Now().Unix(),
	}, firestore.MergeAll)
	fmt.Printf("[lanes] era REVEALED: %s era %d tx=%s\n", lane, era, res.TxHash.Hex())
}
