package batchproof

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

const (
	systemConfigCollection = "system_config"
	batchProofConfigDoc    = "batchProof"
	batchProofsCollection  = "batch_proofs"
)

// SystemConfig is the singleton doc (system_config/batchProof) that holds
// the deployed contract address. Written by the in-app deploy buttons at
// /api/admin/deploy-batch-proof (legacy) or /api/admin/deploy-batch-proof-vrf
// (VRF); read by this package at startup. The ContractVariant field tells
// the manager which on-chain flow to use:
//
//   - "" or "commit-reveal": legacy commit/publishSlots/reveal contract.
//   - "vrf": Chainlink VRF v2.5 contract (BBB4BatchProofVRF.sol).
type SystemConfig struct {
	ContractAddress    string `firestore:"contractAddress"`
	ContractVariant    string `firestore:"contractVariant,omitempty"`
	VRFCoordinator     string `firestore:"vrfCoordinator,omitempty"`
	VRFSubscriptionID  string `firestore:"vrfSubscriptionId,omitempty"`
	VRFKeyHash         string `firestore:"vrfKeyHash,omitempty"`
	DeployerAddress    string `firestore:"deployerAddress,omitempty"`
	DeployTxHash       string `firestore:"deployTxHash,omitempty"`
	DeployedAt         int64  `firestore:"deployedAt,omitempty"`
	OwnerAddress       string `firestore:"ownerAddress,omitempty"`
}

// ProofDoc mirrors what /api/batches/[N]/proof in the frontend reads.
// Field names use Firestore tags so they match the existing frontend
// contract exactly.
//
// Status transitions for VRF batches: "" (absent) → "requested" → "fulfilled".
// Status transitions for legacy commit-reveal: "" → "committed" → "revealed".
//
// VRF state goes in VRFRequestId / VRFRandomness / VRFFulfillTxHash / etc.
// Legacy commit-reveal state goes in SeedHash / CommitTxHash / ServerSeed / etc.
// Most fields are omitempty so the doc shape stays clean for whichever
// variant produced it.
type ProofDoc struct {
	BatchNumber int    `firestore:"batchNumber"`
	Status      string `firestore:"status"`

	// Common to both variants — frontend needs to know which path produced
	// this doc to render the right UI.
	Variant string `firestore:"variant,omitempty"` // "vrf" | "commit-reveal"

	// VRF v2.5 fields (variant=vrf)
	VRFRequestID     string `firestore:"vrfRequestId,omitempty"`     // uint256 as decimal string
	VRFRequestTxHash string `firestore:"vrfRequestTxHash,omitempty"` // tx that submitted requestRandomness
	VRFRequestBlock  int64  `firestore:"vrfRequestBlock,omitempty"`
	VRFRequestedAt   int64  `firestore:"vrfRequestedAt,omitempty"`   // unix sec, our server timestamp
	VRFRandomness    string `firestore:"vrfRandomness,omitempty"`    // 0x-prefixed 32-byte seed (after callback)
	VRFFulfilledAt   int64  `firestore:"vrfFulfilledAt,omitempty"`   // unix sec, on-chain timestamp from getBatch
	VRFCoordinator   string `firestore:"vrfCoordinator,omitempty"`

	// Legacy commit-reveal fields (variant=commit-reveal)
	SeedHash      string `firestore:"seedHash,omitempty"`
	CommitTxHash  string `firestore:"commitTxHash,omitempty"`
	CommitBlock   int64  `firestore:"commitBlock,omitempty"`
	CommittedAt   int64  `firestore:"committedAt,omitempty"`
	PublishTxHash string `firestore:"publishTxHash,omitempty"`
	PublishBlock  int64  `firestore:"publishBlock,omitempty"`
	ServerSeed    string `firestore:"serverSeed,omitempty"`
	RevealTxHash  string `firestore:"revealTxHash,omitempty"`
	RevealBlock   int64  `firestore:"revealBlock,omitempty"`
	RevealedAt    int64  `firestore:"revealedAt,omitempty"`

	// VRF+Commit hybrid fields (variant=vrf-commit). Stored privately
	// during the batch; SaltHash is public on-chain immediately, Salt is
	// public on-chain only after RevealSalt.
	SaltHash         string `firestore:"saltHash,omitempty"`         // 0x-prefixed keccak256(salt)
	ServerSalt       string `firestore:"serverSalt,omitempty"`       // 0x-prefixed 32-byte salt; private until reveal
	CommitTxHashVRF  string `firestore:"commitTxHashVrf,omitempty"`  // tx that submitted requestRandomnessAndCommit (atomic with VRF request)
	RevealSaltTxHash string `firestore:"revealSaltTxHash,omitempty"` // tx that revealed salt at end of batch

	// Common: derived slot positions. Stored privately on commit; gated by
	// the Next.js API layer based on variant + status before exposure to
	// clients. Legacy commit-reveal: gated until status='revealed'. VRF:
	// gated until status='fulfilled'. VRF+commit: gated until status='revealed'.
	JackpotPositions []int `firestore:"jackpotPositions,omitempty"`
	HofPositions     []int `firestore:"hofPositions,omitempty"`
}

// LoadSystemConfig reads system_config/batchProof. Returns ErrNotConfigured
// if the doc doesn't exist (i.e., admin hasn't pressed the deploy button).
func LoadSystemConfig(ctx context.Context, db *firestore.Client) (*SystemConfig, error) {
	snap, err := db.Collection(systemConfigCollection).Doc(batchProofConfigDoc).Get(ctx)
	if err != nil {
		// Firestore returns codes.NotFound; we don't want to import the
		// codes package just for this. Match on string instead.
		if errIsNotFound(err) {
			return nil, fmt.Errorf("%w: system_config/batchProof not found", ErrNotConfigured)
		}
		return nil, fmt.Errorf("read system_config/batchProof: %w", err)
	}
	var cfg SystemConfig
	if err := snap.DataTo(&cfg); err != nil {
		return nil, fmt.Errorf("decode system_config/batchProof: %w", err)
	}
	if cfg.ContractAddress == "" {
		return nil, fmt.Errorf("%w: contractAddress field empty", ErrNotConfigured)
	}
	return &cfg, nil
}

func errIsNotFound(err error) bool {
	if err == nil {
		return false
	}
	// google.golang.org/grpc/status would let us check codes.NotFound,
	// but the go.mod doesn't pull it directly. Substring check on the
	// error message is sufficient for our one call site.
	msg := err.Error()
	return strings.Contains(msg, "NotFound") || strings.Contains(msg, "not found")
}

// LoadProof reads batch_proofs/{batchNumber}. Returns (nil, nil) if not yet
// written — caller should treat that as "this batch hasn't been committed
// yet" and trigger the commit flow.
func LoadProof(ctx context.Context, db *firestore.Client, batchNumber int) (*ProofDoc, error) {
	docID := strconv.Itoa(batchNumber)
	snap, err := db.Collection(batchProofsCollection).Doc(docID).Get(ctx)
	if err != nil {
		if errIsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read batch_proofs/%d: %w", batchNumber, err)
	}
	var doc ProofDoc
	if err := snap.DataTo(&doc); err != nil {
		return nil, fmt.Errorf("decode batch_proofs/%d: %w", batchNumber, err)
	}
	return &doc, nil
}

// SaveProof writes batch_proofs/{batchNumber}.
func SaveProof(ctx context.Context, db *firestore.Client, doc *ProofDoc) error {
	if doc.BatchNumber < 1 {
		return errors.New("batch number must be >= 1")
	}
	docID := strconv.Itoa(doc.BatchNumber)
	_, err := db.Collection(batchProofsCollection).Doc(docID).Set(ctx, doc)
	if err != nil {
		return fmt.Errorf("write batch_proofs/%d: %w", doc.BatchNumber, err)
	}
	return nil
}

// MergeProof patches existing batch_proofs/{batchNumber} fields. Used to
// add reveal data to an already-committed proof.
func MergeProof(ctx context.Context, db *firestore.Client, batchNumber int, updates map[string]interface{}) error {
	if batchNumber < 1 {
		return errors.New("batch number must be >= 1")
	}
	docID := strconv.Itoa(batchNumber)
	merge := make([]firestore.Update, 0, len(updates))
	for k, v := range updates {
		merge = append(merge, firestore.Update{Path: k, Value: v})
	}
	_, err := db.Collection(batchProofsCollection).Doc(docID).Update(ctx, merge)
	if err != nil {
		return fmt.Errorf("merge batch_proofs/%d: %w", batchNumber, err)
	}
	return nil
}

// IterateProofs is unused today but kept as a clean callsite in case we
// add an audit/list endpoint later.
func IterateProofs(ctx context.Context, db *firestore.Client, fn func(*ProofDoc) error) error {
	iter := db.Collection(batchProofsCollection).Documents(ctx)
	for {
		snap, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			return nil
		}
		if err != nil {
			return err
		}
		var doc ProofDoc
		if err := snap.DataTo(&doc); err != nil {
			return err
		}
		if err := fn(&doc); err != nil {
			return err
		}
	}
}

// nowUnix is exposed for tests; production callers use time.Now().Unix().
var nowUnix = func() int64 { return time.Now().Unix() }
