// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BananaWheelAssignmentJournal — on-chain log of wallet → spinIndex assignments
/// @notice Companion contract to BananaWheelProof. BananaWheelProof commits all
///   pre-computed OUTCOMES at period start (so nobody can change spinIndex→outcome
///   after the fact). This contract commits the WALLET→SPINDEX assignments as
///   they happen, in batches of 100, so nobody can reorder/swap who got which
///   spinIndex. Together they close the full provably-fair loop:
///
///     1. BananaWheelProof: "spinIndex N → outcome X" is cryptographically locked
///        before any spin. (Already shipped.)
///     2. BananaWheelAssignmentJournal: "wallet W received spinIndex N at time T"
///        is publicly committed in batches as spins happen. (This contract.)
///
///   A user with their spinId can independently verify both halves end-to-end:
///     - Outcome proof: existing per-spin Merkle proof against BananaWheelProof root
///     - Assignment proof: per-spin Merkle proof against THIS contract's batch root
///
/// @dev Stateless: no funds, no VRF, just append-only commitments. Owner is the
///   admin signer that the wheel-period-keeper cron uses to commit batches. The
///   cron pushes a batch every ~100 spins. Storage is intentionally minimal —
///   each batch is one bytes32 root + two uint32s. Auditors fetch leaves from the
///   server's public feed and verify against the on-chain root.
contract BananaWheelAssignmentJournal {
    // ───── ownership ─────────────────────────────────────────────────────
    address public owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error ZeroHash();
    error EmptyBatch();
    error BatchOutOfOrder(uint256 periodNumber, uint32 expectedBatchIndex, uint32 gotBatchIndex);
    error BatchAlreadyCommitted(uint256 periodNumber, uint32 batchIndex);
    error InvalidRange(uint32 fromIndex, uint32 toIndex);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ───── per-period, per-batch state ───────────────────────────────────
    struct AssignmentBatch {
        bytes32 root;       // Merkle root over leaves: keccak256(abi.encode(uint32 spinIndex, address wallet))
        uint32 fromIndex;   // inclusive — first spinIndex covered by this batch
        uint32 toIndex;     // inclusive — last spinIndex covered (toIndex - fromIndex + 1 = batch size)
        uint64 committedAt; // block timestamp at commit
    }

    /// @notice periodNumber → batchIndex → batch
    mapping(uint256 => mapping(uint32 => AssignmentBatch)) private _batches;

    /// @notice periodNumber → number of batches committed so far (also the
    ///   next expected batchIndex). Enforces strict in-order batching: a
    ///   batch must always be committed as `totalBatches[period]`. This
    ///   prevents back-filling or holes in the journal.
    mapping(uint256 => uint32) public totalBatches;

    event AssignmentBatchCommitted(
        uint256 indexed periodNumber,
        uint32 indexed batchIndex,
        uint32 fromIndex,
        uint32 toIndex,
        uint32 count,
        bytes32 root,
        uint64 committedAt
    );

    constructor(address _initialOwner) {
        if (_initialOwner == address(0)) revert ZeroAddress();
        owner = _initialOwner;
        emit OwnershipTransferred(address(0), _initialOwner);
    }

    /// @notice Commit a Merkle root for a batch of ~100 wallet→spinIndex
    ///   assignments. The off-chain server bundles 100 entries, builds the
    ///   tree from `keccak256(abi.encode(uint32 spinIndex, address wallet))`
    ///   leaves, and submits the root here. After this, any user can request
    ///   a Merkle proof from the server and verify their own assignment
    ///   against this on-chain root.
    /// @param periodNumber  wheel period the batch belongs to
    /// @param batchIndex    must equal totalBatches[periodNumber] (strict order)
    /// @param fromIndex     first spinIndex (inclusive) covered by this batch
    /// @param toIndex       last spinIndex (inclusive) covered by this batch
    /// @param root          Merkle root over the (spinIndex, wallet) leaves
    function commitAssignmentBatch(
        uint256 periodNumber,
        uint32 batchIndex,
        uint32 fromIndex,
        uint32 toIndex,
        bytes32 root
    ) external onlyOwner {
        if (root == bytes32(0)) revert ZeroHash();
        if (toIndex < fromIndex) revert InvalidRange(fromIndex, toIndex);

        uint32 expected = totalBatches[periodNumber];
        if (batchIndex != expected) revert BatchOutOfOrder(periodNumber, expected, batchIndex);

        // Defense in depth: the strict-order check above already prevents a
        // duplicate commit at the same index, but keep this for clarity.
        if (_batches[periodNumber][batchIndex].root != bytes32(0)) {
            revert BatchAlreadyCommitted(periodNumber, batchIndex);
        }

        uint32 count = toIndex - fromIndex + 1;
        if (count == 0) revert EmptyBatch();

        _batches[periodNumber][batchIndex] = AssignmentBatch({
            root: root,
            fromIndex: fromIndex,
            toIndex: toIndex,
            committedAt: uint64(block.timestamp)
        });
        totalBatches[periodNumber] = batchIndex + 1;

        emit AssignmentBatchCommitted(
            periodNumber,
            batchIndex,
            fromIndex,
            toIndex,
            count,
            root,
            uint64(block.timestamp)
        );
    }

    /// @notice Read a single batch.
    function getBatch(uint256 periodNumber, uint32 batchIndex)
        external
        view
        returns (
            bytes32 root,
            uint32 fromIndex,
            uint32 toIndex,
            uint64 committedAt,
            bool committed
        )
    {
        AssignmentBatch memory b = _batches[periodNumber][batchIndex];
        return (b.root, b.fromIndex, b.toIndex, b.committedAt, b.root != bytes32(0));
    }

    /// @notice How many batches have been committed for a period? Equivalent
    ///   to the next expected batchIndex (also the count of locked-in spin
    ///   assignments for the period, in batches of ~100).
    function getTotalBatches(uint256 periodNumber) external view returns (uint32) {
        return totalBatches[periodNumber];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
