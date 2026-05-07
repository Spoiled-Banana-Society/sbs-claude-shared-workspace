package batchproof

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// BBB4BatchProof contract minimal ABI — just the methods we call. Keeping
// this inline avoids the abigen toolchain. The selectors must match the
// deployed contract or transactions will revert.
const contractABI = `[
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"seedHash","type":"bytes32"}],"name":"commit","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"uint8","name":"jackpotSlot","type":"uint8"},{"internalType":"uint8[5]","name":"hofSlots","type":"uint8[5]"}],"name":"publishSlots","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"},{"internalType":"bytes32","name":"serverSeed","type":"bytes32"}],"name":"reveal","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"batchNumber","type":"uint256"}],"name":"getCommit","outputs":[{"internalType":"bytes32","name":"seedHash","type":"bytes32"},{"internalType":"bytes32","name":"serverSeed","type":"bytes32"},{"internalType":"uint64","name":"committedAt","type":"uint64"},{"internalType":"uint64","name":"revealedAt","type":"uint64"},{"internalType":"uint8","name":"jackpotSlot","type":"uint8"},{"internalType":"uint8[5]","name":"hofSlots","type":"uint8[5]"},{"internalType":"bool","name":"slotsPublished","type":"bool"}],"stateMutability":"view","type":"function"}
]`

// BaseChainID is Base mainnet. Hard-coded — this contract only lives on Base.
const BaseChainID int64 = 8453

// Pinned gas params consistent with the frontend's revoke-7702 flow.
// Base basefee is consistently <0.01 gwei; 0.1 gwei maxFee + 0.001 gwei
// priority gives ample margin without ever paying mainnet-Ethereum gas.
var (
	maxFeePerGas         = new(big.Int).Mul(big.NewInt(100_000_000), big.NewInt(1)) // 0.1 gwei = 1e8 wei
	maxPriorityFeePerGas = new(big.Int).Mul(big.NewInt(1_000_000), big.NewInt(1))   // 0.001 gwei = 1e6 wei
)

// Client wraps the BBB4BatchProof contract on Base mainnet. One per process.
// Construct with NewClient. Safe for concurrent use.
type Client struct {
	rpcURL          string
	contractAddress common.Address
	signerKey       *ecdsa.PrivateKey
	signerAddress   common.Address
	chainID         *big.Int
	parsedABI       abi.ABI

	mu     sync.Mutex // serializes nonce reads + tx submissions
	client *ethclient.Client
}

// Config carries the runtime knobs needed to talk to Base.
type Config struct {
	// RPCURL is a Base mainnet HTTP endpoint. Defaults to https://mainnet.base.org.
	RPCURL string
	// ContractAddress is the deployed BBB4BatchProof on Base. If empty,
	// EnsureBatchCommitted etc. return ErrNotConfigured.
	ContractAddress string
	// PrivateKeyHex is the 0x-prefixed (or unprefixed) 64-hex signer key.
	// Must match the contract's `owner`. Required.
	PrivateKeyHex string
	// Variant is "commit-reveal" (default) or "vrf". Only affects which
	// ABI is parsed for legacy methods on Client; VRF methods bind their
	// own ABI internally either way.
	Variant string
}

// VariantCommitReveal / VariantVRF / VariantVRFCommit are the legal
// Variant values. VariantVRFCommit is the hybrid that uses VRF for
// entropy AND a SBS-side salt commit/reveal so positions stay hidden
// from the public during the batch.
const (
	VariantCommitReveal = "commit-reveal"
	VariantVRF          = "vrf"
	VariantVRFCommit    = "vrf-commit"
)

// ErrNotConfigured is returned when a critical setting (contract address,
// signer key) is missing. Callers should treat this as "skip the proof
// system for this batch and log a warning" rather than a fatal error —
// the existing draft flow keeps working without proofs.
var ErrNotConfigured = errors.New("batchproof: not configured")

// NewClient builds a Client. Validates everything upfront so a missing key
// or malformed address fails fast at startup rather than during a fill.
func NewClient(cfg Config) (*Client, error) {
	if cfg.RPCURL == "" {
		cfg.RPCURL = "https://mainnet.base.org"
	}
	if cfg.ContractAddress == "" {
		return nil, fmt.Errorf("%w: contract address empty", ErrNotConfigured)
	}
	if !common.IsHexAddress(cfg.ContractAddress) {
		return nil, fmt.Errorf("invalid contract address: %s", cfg.ContractAddress)
	}
	if cfg.PrivateKeyHex == "" {
		return nil, fmt.Errorf("%w: private key empty", ErrNotConfigured)
	}

	keyHex := strings.TrimPrefix(strings.TrimSpace(cfg.PrivateKeyHex), "0x")
	priv, err := crypto.HexToECDSA(keyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}
	addr := crypto.PubkeyToAddress(priv.PublicKey)

	// For VRF deployments the legacy ABI is never invoked (Manager routes
	// to RequestRandomness / GetBatchVRF instead), but parsing it is cheap
	// and keeps Client.parsedABI non-nil so any accidental legacy call
	// fails with a contract-level revert rather than a nil panic.
	parsed, err := abi.JSON(strings.NewReader(contractABI))
	if err != nil {
		return nil, fmt.Errorf("parsing batch proof ABI: %w", err)
	}

	rpc, err := ethclient.Dial(cfg.RPCURL)
	if err != nil {
		return nil, fmt.Errorf("dialing %s: %w", cfg.RPCURL, err)
	}

	return &Client{
		rpcURL:          cfg.RPCURL,
		contractAddress: common.HexToAddress(cfg.ContractAddress),
		signerKey:       priv,
		signerAddress:   addr,
		chainID:         big.NewInt(BaseChainID),
		parsedABI:       parsed,
		client:          rpc,
	}, nil
}

// SignerAddress returns the address that will sign commit/reveal txs.
// Useful for logging. Should equal the contract's owner().
func (c *Client) SignerAddress() common.Address {
	return c.signerAddress
}

// ContractAddress returns the deployed contract address.
func (c *Client) ContractAddress() common.Address {
	return c.contractAddress
}

// CommitResult bundles what we learned from a successful commit tx.
type CommitResult struct {
	TxHash      common.Hash
	BlockNumber uint64
	GasUsed     uint64
}

// GenerateSeed returns 32 cryptographically random bytes. The caller is
// expected to hand this to Commit(seed) and then never re-derive it
// without persisting first — losing it makes Reveal impossible.
func GenerateSeed() ([]byte, error) {
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		return nil, fmt.Errorf("crypto/rand: %w", err)
	}
	return seed, nil
}

// SeedHash returns keccak256(serverSeed). Matches the contract's commit
// invariant `keccak256(abi.encodePacked(serverSeed)) == seedHash`.
func SeedHash(seed []byte) common.Hash {
	return crypto.Keccak256Hash(seed)
}

// GetCommit reads the on-chain state for a batch. Returns whether the
// batch is committed, whether slots have been published, whether the seed
// has been revealed, and (if revealed) the seed value.
type OnChainCommit struct {
	Committed       bool
	SeedHash        common.Hash
	CommittedAt     uint64
	SlotsPublished  bool
	JackpotSlot     uint8
	HofSlots        [5]uint8
	Revealed        bool
	ServerSeed      common.Hash
	RevealedAt      uint64
}

func (c *Client) GetCommit(ctx context.Context, batchNumber int) (OnChainCommit, error) {
	bound := bind.NewBoundContract(c.contractAddress, c.parsedABI, c.client, c.client, c.client)
	var out []interface{}
	if err := bound.Call(&bind.CallOpts{Context: ctx}, &out, "getCommit", big.NewInt(int64(batchNumber))); err != nil {
		return OnChainCommit{}, fmt.Errorf("getCommit: %w", err)
	}
	if len(out) < 7 {
		return OnChainCommit{}, fmt.Errorf("getCommit returned %d outputs, expected 7", len(out))
	}

	seedHash := out[0].([32]byte)
	serverSeed := out[1].([32]byte)
	committedAt := out[2].(uint64)
	revealedAt := out[3].(uint64)
	jackpotSlot := out[4].(uint8)
	hofSlots := out[5].([5]uint8)
	slotsPublished := out[6].(bool)

	committed := committedAt > 0 && seedHash != [32]byte{}
	revealed := revealedAt > 0 && serverSeed != [32]byte{}

	return OnChainCommit{
		Committed:      committed,
		SeedHash:       common.BytesToHash(seedHash[:]),
		CommittedAt:    committedAt,
		SlotsPublished: slotsPublished,
		JackpotSlot:    jackpotSlot,
		HofSlots:       hofSlots,
		Revealed:       revealed,
		ServerSeed:     common.BytesToHash(serverSeed[:]),
		RevealedAt:     revealedAt,
	}, nil
}

// buildAuth fetches the next nonce and constructs TransactOpts. The
// CALLER must already hold c.mu and must hold it through the
// subsequent bound.Transact() call. Releasing the lock between nonce
// read and tx submission lets concurrent goroutines fetch the same
// nonce and collide ("replacement transaction underpriced"). Real
// incident: at fill #500 the boundary code's RevealBatch and
// PreRequestNextBatchRandomness goroutines collided on nonce.
func (c *Client) buildAuth(ctx context.Context) (*bind.TransactOpts, error) {
	nonce, err := c.client.PendingNonceAt(ctx, c.signerAddress)
	if err != nil {
		return nil, fmt.Errorf("pending nonce: %w", err)
	}

	auth, err := bind.NewKeyedTransactorWithChainID(c.signerKey, c.chainID)
	if err != nil {
		return nil, fmt.Errorf("transactor: %w", err)
	}
	auth.Context = ctx
	auth.Nonce = big.NewInt(int64(nonce))
	auth.GasFeeCap = new(big.Int).Set(maxFeePerGas)
	auth.GasTipCap = new(big.Int).Set(maxPriorityFeePerGas)
	// Let the node estimate gas limit per-tx; the contract methods are
	// small and bounded.
	return auth, nil
}

// Commit submits commit(batchNumber, seedHash) and waits for the receipt.
// Reverts if the batch is already committed on-chain.
func (c *Client) Commit(ctx context.Context, batchNumber int, seedHash common.Hash) (CommitResult, error) {
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, c.parsedABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "commit", big.NewInt(int64(batchNumber)), seedHash)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("commit transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// PublishSlots posts the deterministic slot positions on-chain alongside
// the commit hash. Must be called after Commit and before Reveal.
func (c *Client) PublishSlots(ctx context.Context, batchNumber int, slots BatchSlots) (CommitResult, error) {
	if len(slots.HofPositions) != HofCount {
		return CommitResult{}, fmt.Errorf("expected %d HOF positions, got %d", HofCount, len(slots.HofPositions))
	}
	jackpot := uint8(slots.JackpotPosition)
	var hof [5]uint8
	for i, p := range slots.HofPositions {
		hof[i] = uint8(p)
	}
	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, c.parsedABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "publishSlots", big.NewInt(int64(batchNumber)), jackpot, hof)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("publishSlots transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

// Reveal submits reveal(batchNumber, serverSeed). Contract enforces
// keccak256(serverSeed) == seedHash, so this can only succeed if the seed
// matches the original commit.
func (c *Client) Reveal(ctx context.Context, batchNumber int, serverSeed []byte) (CommitResult, error) {
	if len(serverSeed) != 32 {
		return CommitResult{}, fmt.Errorf("seed must be 32 bytes, got %d", len(serverSeed))
	}
	var seedArr [32]byte
	copy(seedArr[:], serverSeed)

	c.mu.Lock()
	auth, err := c.buildAuth(ctx)
	if err != nil {
		c.mu.Unlock()
		return CommitResult{}, err
	}
	bound := bind.NewBoundContract(c.contractAddress, c.parsedABI, c.client, c.client, c.client)
	tx, err := bound.Transact(auth, "reveal", big.NewInt(int64(batchNumber)), seedArr)
	c.mu.Unlock()
	if err != nil {
		return CommitResult{}, fmt.Errorf("reveal transact: %w", err)
	}
	return c.waitReceipt(ctx, tx)
}

func (c *Client) waitReceipt(ctx context.Context, tx *types.Transaction) (CommitResult, error) {
	// Bound the wait so a stuck Base node can't block draft fills forever.
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	rcpt, err := bind.WaitMined(ctx, c.client, tx)
	if err != nil {
		return CommitResult{}, fmt.Errorf("wait mined: %w", err)
	}
	if rcpt.Status != types.ReceiptStatusSuccessful {
		return CommitResult{}, fmt.Errorf("tx %s reverted", tx.Hash().Hex())
	}
	return CommitResult{
		TxHash:      tx.Hash(),
		BlockNumber: rcpt.BlockNumber.Uint64(),
		GasUsed:     rcpt.GasUsed,
	}, nil
}
