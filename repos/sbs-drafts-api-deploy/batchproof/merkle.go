package batchproof

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Merkle helpers for the vrf-commit-merkle variant.
//
// A "merkle round" covers 10,000 drafts (= 100 batches × 100 drafts each).
// One on-chain ceremony per round: commit salt-hash + request VRF, then
// commitMerkleRoot, then revealSalt at round close. Drafts within the
// round get instant per-draft Merkle proofs against the on-chain root.
//
// The 1/5/94 distribution constraint still holds per-100-draft window:
// each contiguous 100-draft slice contains exactly 1 Jackpot, 5 HOF, 94
// Pro. The round-level derivation produces 100 such windows from a
// single (salt, VRF) pair.
//
// Leaf format (same as wheel, applied to drafts):
//     keccak256( abi.encode(uint256 positionInRound, bytes32 draftTypeHash) )
//   where positionInRound is 0..(MerkleRoundSize-1)
//   and   draftTypeHash = keccak256(bytes(draftType))
//
// Internal node format (sorted pair, OpenZeppelin StandardMerkleTree):
//     keccak256( abi.encode(bytes32 left, bytes32 right) )   when left < right
//     keccak256( abi.encode(bytes32 right, bytes32 left) )   otherwise

// MerkleRoundSize is the number of drafts covered by one merkle round.
// Drafts within the round are indexed by positionInRound (0..MerkleRoundSize-1).
// Window count is MerkleRoundSize / BatchSize — each window is 100 drafts
// and contains exactly 1 JP + 5 HOF + 94 Pro to preserve the existing
// distribution constraint.
const (
	MerkleRoundSize  = 10000
	MerkleWindowSize = BatchSize // 100
	MerkleWindowCount = MerkleRoundSize / MerkleWindowSize // 100
)

// DraftType — pro / hof / jackpot. Leaf hash uses keccak256 of these strings.
const (
	DraftTypePro     = "pro"
	DraftTypeHof     = "hof"
	DraftTypeJackpot = "jackpot"
)

// LeafHash returns the leaf hash for a (positionInRound, draftType) pair.
// Matches the contract's expected input for commitMerkleRoot.
func LeafHash(positionInRound int, draftType string) common.Hash {
	posBytes := make([]byte, 32)
	binary.BigEndian.PutUint64(posBytes[24:], uint64(positionInRound))

	draftTypeHash := crypto.Keccak256([]byte(draftType))

	encoded := make([]byte, 64)
	copy(encoded[:32], posBytes)
	copy(encoded[32:], draftTypeHash)

	return crypto.Keccak256Hash(encoded)
}

// nodeHash hashes two sibling node hashes into their parent. Sorts the
// pair so the proof is direction-agnostic (matches OpenZeppelin
// MerkleProof.processProof).
func nodeHash(a, b common.Hash) common.Hash {
	left, right := a, b
	if bytes.Compare(a[:], b[:]) > 0 {
		left, right = b, a
	}
	encoded := make([]byte, 64)
	copy(encoded[:32], left[:])
	copy(encoded[32:], right[:])
	return crypto.Keccak256Hash(encoded)
}

// MerkleTree holds a built tree's layers (leaves at index 0, root at last).
type MerkleTree struct {
	Leaves []common.Hash
	Layers [][]common.Hash
	Root   common.Hash
}

// BuildMerkleTree constructs a tree from leaves. Empty input is invalid;
// single-leaf trees return the leaf as root.
func BuildMerkleTree(leaves []common.Hash) (*MerkleTree, error) {
	if len(leaves) == 0 {
		return nil, errors.New("cannot build Merkle tree with 0 leaves")
	}
	layers := [][]common.Hash{append([]common.Hash(nil), leaves...)}
	for len(layers[len(layers)-1]) > 1 {
		current := layers[len(layers)-1]
		next := make([]common.Hash, 0, (len(current)+1)/2)
		for i := 0; i < len(current); i += 2 {
			left := current[i]
			var right common.Hash
			if i+1 < len(current) {
				right = current[i+1]
			} else {
				right = current[i] // duplicate odd-out
			}
			next = append(next, nodeHash(left, right))
		}
		layers = append(layers, next)
	}
	return &MerkleTree{
		Leaves: append([]common.Hash(nil), leaves...),
		Layers: layers,
		Root:   layers[len(layers)-1][0],
	}, nil
}

// GetMerkleProof returns the sibling hashes from leaf level up to (but
// not including) the root. The verifier sequentially hashes the leaf
// with each sibling to reconstruct the root.
func (t *MerkleTree) GetMerkleProof(leafIndex int) ([]common.Hash, error) {
	if leafIndex < 0 || leafIndex >= len(t.Leaves) {
		return nil, fmt.Errorf("leafIndex %d out of range [0,%d)", leafIndex, len(t.Leaves))
	}
	proof := make([]common.Hash, 0, len(t.Layers)-1)
	idx := leafIndex
	for level := 0; level < len(t.Layers)-1; level++ {
		layer := t.Layers[level]
		isRight := idx%2 == 1
		var siblingIdx int
		if isRight {
			siblingIdx = idx - 1
		} else {
			siblingIdx = idx + 1
		}
		var sibling common.Hash
		if siblingIdx < len(layer) {
			sibling = layer[siblingIdx]
		} else {
			sibling = layer[idx] // duplicate odd-out
		}
		proof = append(proof, sibling)
		idx /= 2
	}
	return proof, nil
}

// DeriveWindowSubSeed produces a per-window subseed from the round's
// combined seed. Using HMAC-SHA256 with a window-specific tag means each
// 100-draft window is randomized independently, while the master combined
// seed (sha256(salt || vrf)) remains the single source of entropy.
func DeriveWindowSubSeed(combinedSeed []byte, windowIndex int) []byte {
	mac := hmac.New(sha256.New, combinedSeed)
	mac.Write([]byte(fmt.Sprintf("window:%d", windowIndex)))
	return mac.Sum(nil)
}

// RoundOutcomes holds the per-draft draft types for a 10k-draft round.
// Indexed by positionInRound (0..MerkleRoundSize-1). Also includes the
// per-window slot positions for easy lookup of "where in window k is the
// Jackpot" or "where are the 5 HOFs in window k".
type RoundOutcomes struct {
	DraftTypes []string     // length MerkleRoundSize, each "pro"|"hof"|"jackpot"
	Windows    []BatchSlots // length MerkleWindowCount, slot positions per window (0-indexed within window)
}

// DeriveRoundOutcomes builds 10k draft outcomes from a combined seed
// (sha256(salt || vrfRandomness)). Each 100-draft window contains
// exactly 1 Jackpot + 5 HOF + 94 Pro, identical math to the legacy
// per-batch DeriveBatchSlots but parameterized per-window.
//
// Returns RoundOutcomes whose DraftTypes[i] is the type at position i in
// the round. positionInWindow = i % 100, windowIndex = i / 100.
func DeriveRoundOutcomes(combinedSeed []byte) (RoundOutcomes, error) {
	if len(combinedSeed) == 0 {
		return RoundOutcomes{}, errors.New("empty combined seed")
	}

	types := make([]string, MerkleRoundSize)
	windows := make([]BatchSlots, MerkleWindowCount)

	for w := 0; w < MerkleWindowCount; w++ {
		sub := DeriveWindowSubSeed(combinedSeed, w)
		// Re-use the existing per-batch derivation, but pass windowIndex+1
		// as "batch number" for HMAC tag distinctness within the sub-seed.
		// (The sub-seed itself differs per window, so the inner batchNumber
		// is more a label than a security parameter, but consistent with
		// the legacy code path.)
		slots, err := DeriveBatchSlots(sub, w+1)
		if err != nil {
			return RoundOutcomes{}, fmt.Errorf("derive window %d slots: %w", w, err)
		}
		windows[w] = slots

		base := w * MerkleWindowSize
		for i := 0; i < MerkleWindowSize; i++ {
			types[base+i] = DraftTypePro
		}
		types[base+slots.JackpotPosition] = DraftTypeJackpot
		for _, hp := range slots.HofPositions {
			types[base+hp] = DraftTypeHof
		}
	}

	return RoundOutcomes{
		DraftTypes: types,
		Windows:    windows,
	}, nil
}

// BuildRoundMerkleTree derives 10k outcomes from the combined seed,
// computes all 10k leaves, and builds the Merkle tree. Returns the
// tree + the underlying RoundOutcomes (so callers don't have to
// re-derive when persisting).
//
// Used at round open (to commit root on-chain) and at audit time (to
// re-derive everything once salt is revealed).
func BuildRoundMerkleTree(combinedSeed []byte) (*MerkleTree, RoundOutcomes, error) {
	outcomes, err := DeriveRoundOutcomes(combinedSeed)
	if err != nil {
		return nil, RoundOutcomes{}, fmt.Errorf("derive round outcomes: %w", err)
	}
	leaves := make([]common.Hash, MerkleRoundSize)
	for i := 0; i < MerkleRoundSize; i++ {
		leaves[i] = LeafHash(i, outcomes.DraftTypes[i])
	}
	tree, err := BuildMerkleTree(leaves)
	if err != nil {
		return nil, RoundOutcomes{}, fmt.Errorf("build tree: %w", err)
	}
	return tree, outcomes, nil
}

// VerifyMerkleProof recomputes the root from a leaf + proof path and
// compares to the expected root. Mirrored client-side in
// banana-fantasy/lib/batchMerkleClient.ts.
func VerifyMerkleProof(leaf common.Hash, proof []common.Hash, root common.Hash) bool {
	computed := leaf
	for _, sibling := range proof {
		computed = nodeHash(computed, sibling)
	}
	return computed == root
}

// HashStringToHex returns 0x-prefixed lowercase hex of a Hash.
func HashStringToHex(h common.Hash) string {
	return "0x" + common.Bytes2Hex(h[:])
}
