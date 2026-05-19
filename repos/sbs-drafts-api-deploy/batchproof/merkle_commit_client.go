package batchproof

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
)

// merkleCommitContractABI — methods we call on BBB4BatchProofMerkle.sol.
// Same VRF + salt-commit primitives as the vrf-commit contract plus the
// new commitMerkleRoot method. Selectors must match the deployed contract.
const merkleCommitContractABI = `[
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"saltHash","type":"bytes32"}],"name":"requestRandomnessAndCommit","outputs":[{"internalType":"uint256","name":"requestId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"root","type":"bytes32"}],"name":"commitMerkleRoot","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"salt","type":"bytes32"}],"name":"revealSalt","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"}],"name":"getBatch","outputs":[{"internalType":"uint256","name":"vrfRequestId","type":"uint256"},{"internalType":"uint256","name":"randomness","type":"uint256"},{"internalType":"bytes32","name":"saltHash","type":"bytes32"},{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"bytes32","name":"merkleRoot","type":"bytes32"},{"internalType":"uint64","name":"requestedAt","type":"uint64"},{"internalType":"uint64","name":"fulfilledAt","type":"uint64"},{"internalType":"uint64","name":"rootCommittedAt","type":"uint64"},{"internalType":"uint64","name":"revealedAt","type":"uint64"},{"internalType":"bool","name":"fulfilled","type":"bool"},{"internalType":"bool","name":"rootCommitted","type":"bool"},{"internalType":"bool","name":"revealed","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"}
]`

var merkleCommitABI = mustParseMerkleCommitABI()

func mustParseMerkleCommitABI() abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(merkleCommitContractABI))
	if err != nil {
		panic(fmt.Sprintf("batchproof: parse MerkleCommit ABI: %v", err))
	}
	return parsed
}

// MerkleCommitBatchState mirrors the on-chain state for a batch on the
// vrf-commit-merkle contract. Adds MerkleRoot + RootCommittedAt +
// RootCommitted on top of VRFCommitBatchState.
type MerkleCommitBatchState struct {
	VRFRequestID    *big.Int
	Randomness      *big.Int
	SaltHash        common.Hash
	Salt            common.Hash
	MerkleRoot      common.Hash
	RequestedAt     uint64
	FulfilledAt     uint64
	RootCommittedAt uint64
	RevealedAt      uint64
	Fulfilled       bool
	RootCommitted   bool
	Revealed        bool
}

// RandomnessSeed returns the 32-byte big-endian VRF randomness.
func (s MerkleCommitBatchState) RandomnessSeed() []byte {
	if s.Randomness == nil {
		return nil
	}
	out := make([]byte, 32)
	rb := s.Randomness.Bytes()
	copy(out[32-len(rb):], rb)
	return out
}

// RequestRandomnessAndCommitMerkle is the merkle-variant analog. Same
// on-chain selector as the vrf-commit contract (requestRandomnessAndCommit)
// but routed through the merkle-variant Client. Keeping a separate Go
// method makes call sites unambiguous about which contract is being hit.
func (c *Client) RequestRandomnessAndCommitMerkle(ctx context.Context, batchNumber int, saltHash common.Hash) (CommitResult, error) {
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, merkleCommitABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "requestRandomnessAndCommit", big.NewInt(int64(batchNumber)), saltHash)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("merkle requestRandomnessAndCommit transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// CommitMerkleRoot publishes the 32-byte Merkle root of all 100
// pre-derived (position, draftType) leaves. Must be called after VRF
// fulfills and before any draft in the batch fills.
func (c *Client) CommitMerkleRoot(ctx context.Context, batchNumber int, root common.Hash) (CommitResult, error) {
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, merkleCommitABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "commitMerkleRoot", big.NewInt(int64(batchNumber)), root)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("commitMerkleRoot transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// RevealSaltMerkle posts the previously-committed salt for a batch on
// the merkle-variant contract.
func (c *Client) RevealSaltMerkle(ctx context.Context, batchNumber int, salt common.Hash) (CommitResult, error) {
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, merkleCommitABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "revealSalt", big.NewInt(int64(batchNumber)), salt)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("merkle revealSalt transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// GetBatchMerkleCommit reads the full on-chain state for a batch on the
// merkle-variant contract.
func (c *Client) GetBatchMerkleCommit(ctx context.Context, batchNumber int) (MerkleCommitBatchState, error) {
	bound := bind.NewBoundContract(c.contractAddress, merkleCommitABI, c.client, c.client, c.client)
	var out []interface{}
	if err := bound.Call(&bind.CallOpts{Context: ctx}, &out, "getBatch", big.NewInt(int64(batchNumber))); err != nil {
		return MerkleCommitBatchState{}, fmt.Errorf("getBatch: %w", err)
	}
	if len(out) < 12 {
		return MerkleCommitBatchState{}, fmt.Errorf("getBatch returned %d outputs, expected 12", len(out))
	}

	requestID, _ := out[0].(*big.Int)
	randomness, _ := out[1].(*big.Int)
	saltHashRaw, _ := out[2].([32]byte)
	saltRaw, _ := out[3].([32]byte)
	merkleRootRaw, _ := out[4].([32]byte)
	requestedAt, _ := out[5].(uint64)
	fulfilledAt, _ := out[6].(uint64)
	rootCommittedAt, _ := out[7].(uint64)
	revealedAt, _ := out[8].(uint64)
	fulfilled, _ := out[9].(bool)
	rootCommitted, _ := out[10].(bool)
	revealed, _ := out[11].(bool)

	return MerkleCommitBatchState{
		VRFRequestID:    requestID,
		Randomness:      randomness,
		SaltHash:        common.BytesToHash(saltHashRaw[:]),
		Salt:            common.BytesToHash(saltRaw[:]),
		MerkleRoot:      common.BytesToHash(merkleRootRaw[:]),
		RequestedAt:     requestedAt,
		FulfilledAt:     fulfilledAt,
		RootCommittedAt: rootCommittedAt,
		RevealedAt:      revealedAt,
		Fulfilled:       fulfilled,
		RootCommitted:   rootCommitted,
		Revealed:        revealed,
	}, nil
}

// MerkleCommitOwner reads the current owner of the merkle-variant contract.
func (c *Client) MerkleCommitOwner(ctx context.Context) (common.Address, error) {
	bound := bind.NewBoundContract(c.contractAddress, merkleCommitABI, c.client, c.client, c.client)
	var out []interface{}
	if err := bound.Call(&bind.CallOpts{Context: ctx}, &out, "owner"); err != nil {
		return common.Address{}, err
	}
	if len(out) == 0 {
		return common.Address{}, errors.New("owner() returned no outputs")
	}
	addr, _ := out[0].(common.Address)
	return addr, nil
}

// WaitForMerkleCommitFulfillment polls GetBatchMerkleCommit until the
// coordinator callback fires or the deadline elapses. Identical timing
// semantics to WaitForVRFCommitFulfillment.
func (c *Client) WaitForMerkleCommitFulfillment(
	ctx context.Context,
	batchNumber int,
	pollInterval, deadline time.Duration,
) (MerkleCommitBatchState, error) {
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	if deadline <= 0 {
		deadline = 5 * time.Minute
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		state, err := c.GetBatchMerkleCommit(timeoutCtx, batchNumber)
		if err == nil && state.Fulfilled {
			return state, nil
		}
		select {
		case <-timeoutCtx.Done():
			if err != nil {
				return MerkleCommitBatchState{}, fmt.Errorf("merkle VRF wait failed: %w", err)
			}
			return MerkleCommitBatchState{}, fmt.Errorf("merkle VRF fulfillment timed out for batch %d after %s", batchNumber, deadline)
		case <-ticker.C:
			continue
		}
	}
}
