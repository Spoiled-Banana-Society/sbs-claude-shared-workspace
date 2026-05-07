// Package batchproof implements the on-chain provably-fair commit/reveal
// system for SBS draft batches. Every 100 drafts contains exactly 94 Pro,
// 5 HOF, 1 Jackpot. The 6 special slot positions within a batch are
// derived deterministically from a server seed whose hash is committed
// on Base mainnet (BBB4BatchProof contract) before the first draft of the
// batch fills, then the seed is revealed after the last draft fills.
//
// The slot derivation algorithm here MUST produce byte-identical output
// to the JavaScript implementation in banana-fantasy/lib/batchProof.ts.
// If the two ever disagree, the proof has failed.
package batchproof

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	BatchSize     = 100
	HofCount      = 5
	JackpotCount  = 1
	totalSpecials = HofCount + JackpotCount
)

// BatchSlots holds the deterministic position assignments for a single
// batch. Positions are 0-indexed within the batch (0..99).
type BatchSlots struct {
	JackpotPosition int
	HofPositions    []int // length 5
}

// DeriveBatchSlots reproduces the canonical slot derivation. Algorithm:
//
//	for i in 0..6:
//	  tag = "slot:" + batchNumber + ":" + i
//	  mac = HMAC_SHA256(serverSeed, tag)
//	  raw = uint64( first 8 bytes of mac, big-endian )
//	  position = raw mod 100
//	  while position is already taken:
//	    position = (position + 1) mod 100
//	  i==0 → Jackpot
//	  i in 1..5 → HOF
func DeriveBatchSlots(serverSeed []byte, batchNumber int) (BatchSlots, error) {
	if len(serverSeed) == 0 {
		return BatchSlots{}, errors.New("empty seed")
	}
	if batchNumber < 1 {
		return BatchSlots{}, fmt.Errorf("batch number must be >= 1, got %d", batchNumber)
	}

	taken := make(map[int]bool, totalSpecials)
	positions := make([]int, totalSpecials)

	for i := 0; i < totalSpecials; i++ {
		tag := fmt.Sprintf("slot:%d:%d", batchNumber, i)
		h := hmac.New(sha256.New, serverSeed)
		h.Write([]byte(tag))
		mac := h.Sum(nil)

		raw := binary.BigEndian.Uint64(mac[:8])
		position := int(raw % uint64(BatchSize))

		walks := 0
		for taken[position] && walks < BatchSize {
			position = (position + 1) % BatchSize
			walks++
		}
		if taken[position] {
			return BatchSlots{}, fmt.Errorf("could not place slot %d after %d walks", i, BatchSize)
		}

		taken[position] = true
		positions[i] = position
	}

	hof := make([]int, HofCount)
	copy(hof, positions[JackpotCount:])
	return BatchSlots{
		JackpotPosition: positions[0],
		HofPositions:    hof,
	}, nil
}

// CombinedSeed combines a server-side salt with on-chain VRF randomness
// into the seed used for slot derivation in the vrf-commit hybrid.
//
//	combined = sha256(salt || randomness)
//
// Mixing both sources means neither party alone can predetermine the
// outcome: SBS can't grind seeds (VRF entropy is bound on-chain in the
// commit tx), and the public can't peek (salt is hidden until reveal).
// The output is fed into DeriveBatchSlots like any other 32-byte seed.
func CombinedSeed(salt []byte, randomness []byte) []byte {
	h := sha256.New()
	h.Write(salt)
	h.Write(randomness)
	return h.Sum(nil)
}

// PositionsToGlobalDraftNumbers converts batch-local positions (0..99) to
// the 1-indexed global draft numbers (BBB #N) that DraftLeagueTracker uses
// to match HofLeagueIds / JackpotLeagueIds against FilledLeaguesCount.
//
// batchNumber is 1-indexed. Batch 1 covers global drafts 1..100, batch 2
// covers 101..200, etc.
func PositionsToGlobalDraftNumbers(positions []int, batchNumber int) []int {
	out := make([]int, len(positions))
	batchStart := (batchNumber - 1) * BatchSize
	for i, p := range positions {
		out[i] = batchStart + p + 1 // +1 because draft numbers are 1-indexed
	}
	return out
}
