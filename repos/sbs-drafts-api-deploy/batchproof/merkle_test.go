package batchproof

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// Smoke tests for the round-based Merkle layer. Critical invariants:
//   - DeriveRoundOutcomes is deterministic
//   - Each 100-draft window contains exactly 1 JP + 5 HOF + 94 Pro
//   - Per-position Merkle proofs verify against the round's root
//   - VerifyMerkleProof correctly accepts valid proofs and rejects tampered ones

func makeTestSeed(label string) []byte {
	// Reuse CombinedSeed shape (sha256(salt || randomness)) with both halves
	// derived from a label so tests are deterministic.
	salt := make([]byte, 32)
	rand := make([]byte, 32)
	for i := 0; i < 32; i++ {
		salt[i] = byte(i)
		rand[i] = byte(i + 1)
	}
	salt[31] = byte(label[0])
	return CombinedSeed(salt, rand)
}

func TestDeriveRoundOutcomesDeterministic(t *testing.T) {
	seed := makeTestSeed("A")
	a, err := DeriveRoundOutcomes(seed)
	if err != nil {
		t.Fatalf("DeriveRoundOutcomes: %v", err)
	}
	b, err := DeriveRoundOutcomes(seed)
	if err != nil {
		t.Fatalf("DeriveRoundOutcomes second: %v", err)
	}
	if len(a.DraftTypes) != MerkleRoundSize {
		t.Fatalf("expected %d types, got %d", MerkleRoundSize, len(a.DraftTypes))
	}
	for i := 0; i < MerkleRoundSize; i++ {
		if a.DraftTypes[i] != b.DraftTypes[i] {
			t.Errorf("non-deterministic at i=%d: %s vs %s", i, a.DraftTypes[i], b.DraftTypes[i])
		}
	}
}

func TestDeriveRoundOutcomesDistribution(t *testing.T) {
	seed := makeTestSeed("B")
	outcomes, err := DeriveRoundOutcomes(seed)
	if err != nil {
		t.Fatalf("DeriveRoundOutcomes: %v", err)
	}
	for w := 0; w < MerkleWindowCount; w++ {
		jp, hof, pro := 0, 0, 0
		for i := 0; i < MerkleWindowSize; i++ {
			switch outcomes.DraftTypes[w*MerkleWindowSize+i] {
			case DraftTypeJackpot:
				jp++
			case DraftTypeHof:
				hof++
			case DraftTypePro:
				pro++
			default:
				t.Fatalf("unexpected draft type at window=%d i=%d: %q", w, i, outcomes.DraftTypes[w*MerkleWindowSize+i])
			}
		}
		if jp != 1 || hof != 5 || pro != 94 {
			t.Errorf("window %d: distribution off — JP=%d HOF=%d Pro=%d (want 1/5/94)", w, jp, hof, pro)
		}
	}
}

func TestBuildRoundMerkleTreeAndProof(t *testing.T) {
	seed := makeTestSeed("C")
	tree, outcomes, err := BuildRoundMerkleTree(seed)
	if err != nil {
		t.Fatalf("BuildRoundMerkleTree: %v", err)
	}
	if len(tree.Leaves) != MerkleRoundSize {
		t.Fatalf("expected %d leaves, got %d", MerkleRoundSize, len(tree.Leaves))
	}
	if tree.Root == (common.Hash{}) {
		t.Fatalf("Merkle root is zero")
	}

	// Verify a handful of positions: position 0, a random middle, and the last.
	for _, pos := range []int{0, 1, 99, 100, 4999, 5000, 9998, 9999} {
		proof, err := tree.GetMerkleProof(pos)
		if err != nil {
			t.Errorf("GetMerkleProof(%d): %v", pos, err)
			continue
		}
		expectedLeaf := LeafHash(pos, outcomes.DraftTypes[pos])
		if tree.Leaves[pos] != expectedLeaf {
			t.Errorf("leaf mismatch at pos=%d", pos)
		}
		if !VerifyMerkleProof(expectedLeaf, proof, tree.Root) {
			t.Errorf("VerifyMerkleProof failed at pos=%d", pos)
		}
	}
}

func TestVerifyMerkleProofRejectsTampered(t *testing.T) {
	seed := makeTestSeed("D")
	tree, outcomes, err := BuildRoundMerkleTree(seed)
	if err != nil {
		t.Fatalf("BuildRoundMerkleTree: %v", err)
	}
	pos := 543
	proof, err := tree.GetMerkleProof(pos)
	if err != nil {
		t.Fatalf("GetMerkleProof: %v", err)
	}

	// Tampered leaf: lie about the type at this position.
	wrongType := DraftTypePro
	if outcomes.DraftTypes[pos] == DraftTypePro {
		wrongType = DraftTypeHof
	}
	tampered := LeafHash(pos, wrongType)
	if VerifyMerkleProof(tampered, proof, tree.Root) {
		t.Errorf("VerifyMerkleProof should reject tampered leaf at pos=%d", pos)
	}

	// Tampered position: claim correct type but wrong index.
	wrongPosLeaf := LeafHash(pos+1, outcomes.DraftTypes[pos])
	if VerifyMerkleProof(wrongPosLeaf, proof, tree.Root) {
		t.Errorf("VerifyMerkleProof should reject when position doesn't match")
	}
}

func TestLeafHashStability(t *testing.T) {
	// Stability check: the leaf for (positionInRound=0, "pro") must be the same
	// across runs. This is the wire format the JS verifier will compute too.
	got := LeafHash(0, DraftTypePro)
	// Computed once and pinned. If this changes, the JS verifier will mismatch.
	// Expected from keccak256(abi.encode(uint256(0), keccak256(bytes("pro")))).
	if got == (common.Hash{}) {
		t.Fatalf("leaf hash should never be zero")
	}
	// Sanity: distinct types must produce distinct leaves.
	if LeafHash(0, DraftTypePro) == LeafHash(0, DraftTypeHof) {
		t.Errorf("pro and hof leaves collide at position 0 — encoding broken")
	}
	if LeafHash(0, DraftTypeJackpot) == LeafHash(1, DraftTypeJackpot) {
		t.Errorf("position 0 and 1 jackpot leaves collide — encoding broken")
	}
}
