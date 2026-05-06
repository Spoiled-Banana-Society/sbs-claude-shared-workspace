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

// vrfCommitContractABI — methods we call on BBB4BatchProofVRFCommit.sol.
// Inlined to avoid the abigen toolchain. Selectors must match the deployed
// contract.
const vrfCommitContractABI = `[
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"saltHash","type":"bytes32"}],"name":"requestRandomnessAndCommit","outputs":[{"internalType":"uint256","name":"requestId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"salt","type":"bytes32"}],"name":"revealSalt","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"}],"name":"getBatch","outputs":[{"internalType":"uint256","name":"vrfRequestId","type":"uint256"},{"internalType":"uint256","name":"randomness","type":"uint256"},{"internalType":"bytes32","name":"saltHash","type":"bytes32"},{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"uint64","name":"requestedAt","type":"uint64"},{"internalType":"uint64","name":"fulfilledAt","type":"uint64"},{"internalType":"uint64","name":"revealedAt","type":"uint64"},{"internalType":"bool","name":"fulfilled","type":"bool"},{"internalType":"bool","name":"revealed","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"}
]`

var vrfCommitABI = mustParseVrfCommitABI()

func mustParseVrfCommitABI() abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(vrfCommitContractABI))
	if err != nil {
		panic(fmt.Sprintf("batchproof: parse VRFCommit ABI: %v", err))
	}
	return parsed
}

// VRFCommitBatchState mirrors the on-chain state for a batch on the
// VRF+commit hybrid contract.
type VRFCommitBatchState struct {
	VRFRequestID *big.Int
	Randomness   *big.Int
	SaltHash     common.Hash
	Salt         common.Hash
	RequestedAt  uint64
	FulfilledAt  uint64
	RevealedAt   uint64
	Fulfilled    bool
	Revealed     bool
}

// RandomnessSeed returns the 32-byte big-endian VRF randomness, padded
// with leading zeros if needed. Mirrors VRFBatchState.RandomnessSeed.
func (s VRFCommitBatchState) RandomnessSeed() []byte {
	if s.Randomness == nil {
		return nil
	}
	out := make([]byte, 32)
	rb := s.Randomness.Bytes()
	copy(out[32-len(rb):], rb)
	return out
}

// RequestRandomnessAndCommit atomically commits a salt hash and submits a
// Chainlink VRF v2.5 request for the given batch. The contract emits both
// BatchRequested (with the salt hash) and the underlying coordinator
// request log.
func (c *Client) RequestRandomnessAndCommit(ctx context.Context, batchNumber int, saltHash common.Hash) (CommitResult, error) {
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, vrfCommitABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "requestRandomnessAndCommit", big.NewInt(int64(batchNumber)), saltHash)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("requestRandomnessAndCommit transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// RevealSalt posts the previously-committed salt for a batch. Reverts if
// keccak256(salt) != saltHash on-chain (catches any storage corruption or
// confused mappings before the public sees a bad reveal).
func (c *Client) RevealSalt(ctx context.Context, batchNumber int, salt common.Hash) (CommitResult, error) {
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, vrfCommitABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "revealSalt", big.NewInt(int64(batchNumber)), salt)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("revealSalt transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// GetBatchVRFCommit reads the full on-chain state for a batch.
func (c *Client) GetBatchVRFCommit(ctx context.Context, batchNumber int) (VRFCommitBatchState, error) {
	bound := bind.NewBoundContract(c.contractAddress, vrfCommitABI, c.client, c.client, c.client)
	var out []interface{}
	if err := bound.Call(&bind.CallOpts{Context: ctx}, &out, "getBatch", big.NewInt(int64(batchNumber))); err != nil {
		return VRFCommitBatchState{}, fmt.Errorf("getBatch: %w", err)
	}
	if len(out) < 9 {
		return VRFCommitBatchState{}, fmt.Errorf("getBatch returned %d outputs, expected 9", len(out))
	}

	requestID, _ := out[0].(*big.Int)
	randomness, _ := out[1].(*big.Int)
	saltHashRaw, _ := out[2].([32]byte)
	saltRaw, _ := out[3].([32]byte)
	requestedAt, _ := out[4].(uint64)
	fulfilledAt, _ := out[5].(uint64)
	revealedAt, _ := out[6].(uint64)
	fulfilled, _ := out[7].(bool)
	revealed, _ := out[8].(bool)

	return VRFCommitBatchState{
		VRFRequestID: requestID,
		Randomness:   randomness,
		SaltHash:     common.BytesToHash(saltHashRaw[:]),
		Salt:         common.BytesToHash(saltRaw[:]),
		RequestedAt:  requestedAt,
		FulfilledAt:  fulfilledAt,
		RevealedAt:   revealedAt,
		Fulfilled:    fulfilled,
		Revealed:     revealed,
	}, nil
}

// VRFCommitOwner reads the current owner of the VRF+commit contract.
func (c *Client) VRFCommitOwner(ctx context.Context) (common.Address, error) {
	bound := bind.NewBoundContract(c.contractAddress, vrfCommitABI, c.client, c.client, c.client)
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

// WaitForVRFCommitFulfillment polls GetBatchVRFCommit until the coordinator
// callback fires or the deadline elapses. Identical timing semantics to
// WaitForVRFFulfillment for the VRF-only contract.
func (c *Client) WaitForVRFCommitFulfillment(
	ctx context.Context,
	batchNumber int,
	pollInterval, deadline time.Duration,
) (VRFCommitBatchState, error) {
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
		state, err := c.GetBatchVRFCommit(timeoutCtx, batchNumber)
		if err == nil && state.Fulfilled {
			return state, nil
		}
		select {
		case <-timeoutCtx.Done():
			if err != nil {
				return VRFCommitBatchState{}, fmt.Errorf("VRF+commit wait failed: %w", err)
			}
			return VRFCommitBatchState{}, fmt.Errorf("VRF+commit fulfillment timed out for batch %d after %s", batchNumber, deadline)
		case <-ticker.C:
			continue
		}
	}
}
