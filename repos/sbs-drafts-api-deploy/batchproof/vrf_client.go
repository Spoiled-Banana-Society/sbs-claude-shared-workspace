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

// vrfContractABI — methods we call on BBB4BatchProofVRF.sol. Inlined to
// avoid the abigen toolchain; selectors must match the deployed contract.
const vrfContractABI = `[
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"}],"name":"requestRandomness","outputs":[{"internalType":"uint256","name":"requestId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"}],"name":"getBatch","outputs":[{"internalType":"uint256","name":"vrfRequestId","type":"uint256"},{"internalType":"uint256","name":"randomness","type":"uint256"},{"internalType":"uint64","name":"requestedAt","type":"uint64"},{"internalType":"uint64","name":"fulfilledAt","type":"uint64"},{"internalType":"bool","name":"fulfilled","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"}
]`

// VRFBatchState mirrors the on-chain state for a batch as returned by
// getBatch(uint256). Until the Chainlink VRF callback fires, Fulfilled is
// false and Randomness is zero.
type VRFBatchState struct {
	VRFRequestID *big.Int
	Randomness   *big.Int
	RequestedAt  uint64
	FulfilledAt  uint64
	Fulfilled    bool
}

// RandomnessSeed converts the on-chain uint256 randomness into the 32-byte
// seed our slot derivation expects. Big-endian — same byte order Chainlink
// uses for VRF outputs.
func (s VRFBatchState) RandomnessSeed() []byte {
	if s.Randomness == nil {
		return nil
	}
	out := make([]byte, 32)
	rb := s.Randomness.Bytes()
	copy(out[32-len(rb):], rb) // zero-pad to 32 bytes
	return out
}

// vrfABI is the lazily-parsed ABI used by the VRF call helpers.
var vrfABI = mustParseABI(vrfContractABI)

func mustParseABI(s string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(s))
	if err != nil {
		panic(fmt.Sprintf("batchproof: parse VRF ABI: %v", err))
	}
	return parsed
}

// RequestRandomness submits a Chainlink VRF v2.5 request for the given
// batch number. The contract emits BatchRequested; the coordinator will
// later call rawFulfillRandomWords which emits BatchFulfilled. Wait for
// fulfillment via WaitForVRFFulfillment.
func (c *Client) RequestRandomness(ctx context.Context, batchNumber int) (CommitResult, error) {
	auth, err := c.buildAuth(ctx)
	if err != nil {
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, vrfABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "requestRandomness", big.NewInt(int64(batchNumber)))
	if err != nil {
		return CommitResult{}, fmt.Errorf("requestRandomness transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// GetBatchVRF reads the current VRF state for a batch from the contract.
// Whether or not the VRF callback has fired, this returns the recorded
// state.
func (c *Client) GetBatchVRF(ctx context.Context, batchNumber int) (VRFBatchState, error) {
	bound := bind.NewBoundContract(c.contractAddress, vrfABI, c.client, c.client, c.client)
	var out []interface{}
	if err := bound.Call(&bind.CallOpts{Context: ctx}, &out, "getBatch", big.NewInt(int64(batchNumber))); err != nil {
		return VRFBatchState{}, fmt.Errorf("getBatch: %w", err)
	}
	if len(out) < 5 {
		return VRFBatchState{}, fmt.Errorf("getBatch returned %d outputs, expected 5", len(out))
	}

	requestID, _ := out[0].(*big.Int)
	randomness, _ := out[1].(*big.Int)
	requestedAt, _ := out[2].(uint64)
	fulfilledAt, _ := out[3].(uint64)
	fulfilled, _ := out[4].(bool)

	return VRFBatchState{
		VRFRequestID: requestID,
		Randomness:   randomness,
		RequestedAt:  requestedAt,
		FulfilledAt:  fulfilledAt,
		Fulfilled:    fulfilled,
	}, nil
}

// WaitForVRFFulfillment polls GetBatchVRF every pollInterval until the
// callback fires or the deadline elapses. Returns the fulfilled state on
// success, or a wrapped error on timeout / cancellation.
//
// Chainlink VRF on Base typically fulfills within 30-60 seconds (3 block
// confirmations + processing). We default to a 5 minute deadline and
// 5 second poll interval — generous enough to absorb Chainlink hiccups
// without blocking a draft fill forever.
func (c *Client) WaitForVRFFulfillment(
	ctx context.Context,
	batchNumber int,
	pollInterval time.Duration,
	deadline time.Duration,
) (VRFBatchState, error) {
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
		state, err := c.GetBatchVRF(timeoutCtx, batchNumber)
		if err == nil && state.Fulfilled {
			return state, nil
		}
		select {
		case <-timeoutCtx.Done():
			if err != nil {
				return VRFBatchState{}, fmt.Errorf("VRF wait failed: %w", err)
			}
			return VRFBatchState{}, fmt.Errorf("VRF fulfillment timed out for batch %d after %s", batchNumber, deadline)
		case <-ticker.C:
			continue
		}
	}
}

// VRFOwner reads the current owner of the VRF contract.
func (c *Client) VRFOwner(ctx context.Context) (common.Address, error) {
	bound := bind.NewBoundContract(c.contractAddress, vrfABI, c.client, c.client, c.client)
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

