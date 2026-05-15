// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BBB4BatchProofMerkle — VRF + salt-commit + Merkle root for draft batches
/// @notice Same provable-fairness primitives as BBB4BatchProofVRFCommit (VRF
///   randomness bound on-chain, salt sealed off-chain until batch close)
///   with one new method: `commitMerkleRoot(batchNumber, root)`. The root
///   covers all 100 pre-derived draft positions for the batch. Each draft
///   carries a Merkle proof tying its position to this root, so any
///   individual draft is verifiable the moment its slot machine stops —
///   without waiting for batch close.
///
///   Lifecycle per batch:
///     1. `requestRandomnessAndCommit(batchNumber, saltHash)` — atomic
///        commit + VRF request
///     2. VRF coordinator fulfills via `rawFulfillRandomWords`
///     3. `commitMerkleRoot(batchNumber, root)` — owner publishes the
///        Merkle root of all 100 pre-derived (position, draftType) leaves
///     4. Batch fills draft-by-draft; each draft gets a Merkle proof
///        verifiable client-side against the committed root
///     5. `revealSalt(batchNumber, salt)` — at batch close, owner
///        reveals the salt so anyone can re-derive every position from
///        scratch and confirm the root matches
///
/// @dev Owner-only request + commit-root + reveal. Coordinator-only callback. No funds.

interface IVRFCoordinatorV2Plus {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function requestRandomWords(RandomWordsRequest calldata req) external returns (uint256 requestId);
}

contract BBB4BatchProofMerkle {
    // ───── ownership ─────────────────────────────────────────────────────
    address public owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotCoordinator();
    error ZeroAddress();
    error ZeroHash();
    error AlreadyRequested(uint256 batchNumber);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 batchNumber);
    error NotFulfilled(uint256 batchNumber);
    error AlreadyCommitted(uint256 batchNumber);
    error RootNotCommitted(uint256 batchNumber);
    error AlreadyRevealed(uint256 batchNumber);
    error SaltMismatch(uint256 batchNumber);
    error NoRandomWords();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ───── VRF config (immutable per-deployment) ─────────────────────────
    address public immutable vrfCoordinator;
    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;

    uint32 public constant CALLBACK_GAS_LIMIT = 200_000;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;

    bytes4 internal constant EXTRA_ARGS_V1_TAG = 0x92fd1338;

    // ───── per-batch state ───────────────────────────────────────────────
    struct Batch {
        uint256 vrfRequestId;       // 0 until requested
        uint256 randomness;         // 0 until VRF fulfills
        bytes32 saltHash;           // keccak256(salt) — committed at request time
        bytes32 salt;               // 0x0 until revealSalt() succeeds
        bytes32 merkleRoot;         // 0x0 until commitMerkleRoot() succeeds
        uint64 requestedAt;
        uint64 fulfilledAt;         // 0 until VRF fulfills
        uint64 rootCommittedAt;     // 0 until merkle root committed
        uint64 revealedAt;          // 0 until salt revealed
    }

    mapping(uint256 => Batch) private _batches;
    mapping(uint256 => uint256) private _requestToBatch;

    event BatchRequested(
        uint256 indexed batchNumber,
        uint256 indexed requestId,
        bytes32 saltHash,
        uint64 requestedAt
    );
    event BatchFulfilled(
        uint256 indexed batchNumber,
        uint256 indexed requestId,
        uint256 randomness,
        uint64 fulfilledAt
    );
    event BatchRootCommitted(
        uint256 indexed batchNumber,
        bytes32 merkleRoot,
        uint64 rootCommittedAt
    );
    event BatchRevealed(
        uint256 indexed batchNumber,
        bytes32 salt,
        uint64 revealedAt
    );

    constructor(
        address _vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        address _initialOwner
    ) {
        if (_vrfCoordinator == address(0) || _initialOwner == address(0)) revert ZeroAddress();
        vrfCoordinator = _vrfCoordinator;
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        owner = _initialOwner;
        emit OwnershipTransferred(address(0), _initialOwner);
    }

    /// @notice Step 1: atomically commit salt-hash + request VRF randomness.
    function requestRandomnessAndCommit(uint256 batchNumber, bytes32 saltHash)
        external
        onlyOwner
        returns (uint256 requestId)
    {
        if (_batches[batchNumber].vrfRequestId != 0) revert AlreadyRequested(batchNumber);
        if (saltHash == bytes32(0)) revert ZeroHash();

        bytes memory extraArgs = abi.encodePacked(EXTRA_ARGS_V1_TAG, abi.encode(false));

        IVRFCoordinatorV2Plus.RandomWordsRequest memory req = IVRFCoordinatorV2Plus.RandomWordsRequest({
            keyHash: keyHash,
            subId: subscriptionId,
            requestConfirmations: REQUEST_CONFIRMATIONS,
            callbackGasLimit: CALLBACK_GAS_LIMIT,
            numWords: NUM_WORDS,
            extraArgs: extraArgs
        });

        requestId = IVRFCoordinatorV2Plus(vrfCoordinator).requestRandomWords(req);

        _batches[batchNumber] = Batch({
            vrfRequestId: requestId,
            randomness: 0,
            saltHash: saltHash,
            salt: bytes32(0),
            merkleRoot: bytes32(0),
            requestedAt: uint64(block.timestamp),
            fulfilledAt: 0,
            rootCommittedAt: 0,
            revealedAt: 0
        });
        _requestToBatch[requestId] = batchNumber;

        emit BatchRequested(batchNumber, requestId, saltHash, uint64(block.timestamp));
    }

    /// @notice Step 2 (coordinator callback): records VRF randomness.
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != vrfCoordinator) revert NotCoordinator();
        uint256 batchNumber = _requestToBatch[requestId];
        if (batchNumber == 0) revert UnknownRequest(requestId);
        if (_batches[batchNumber].fulfilledAt != 0) revert AlreadyFulfilled(batchNumber);
        if (randomWords.length == 0) revert NoRandomWords();

        _batches[batchNumber].randomness = randomWords[0];
        _batches[batchNumber].fulfilledAt = uint64(block.timestamp);

        emit BatchFulfilled(batchNumber, requestId, randomWords[0], uint64(block.timestamp));
    }

    /// @notice Step 3: owner commits the Merkle root of the batch's pre-derived
    ///   100 (position, draftType) leaves. Required before drafts in the batch
    ///   can be assigned proofs.
    function commitMerkleRoot(uint256 batchNumber, bytes32 root) external onlyOwner {
        Batch storage b = _batches[batchNumber];
        if (b.fulfilledAt == 0) revert NotFulfilled(batchNumber);
        if (b.rootCommittedAt != 0) revert AlreadyCommitted(batchNumber);
        if (root == bytes32(0)) revert ZeroHash();

        b.merkleRoot = root;
        b.rootCommittedAt = uint64(block.timestamp);

        emit BatchRootCommitted(batchNumber, root, uint64(block.timestamp));
    }

    /// @notice Step 4: reveal salt at batch close. Verifies keccak256(salt)
    ///   matches the committed hash so the public can re-derive every
    ///   position from scratch and confirm the Merkle root.
    function revealSalt(uint256 batchNumber, bytes32 salt) external onlyOwner {
        Batch storage b = _batches[batchNumber];
        if (b.rootCommittedAt == 0) revert RootNotCommitted(batchNumber);
        if (b.revealedAt != 0) revert AlreadyRevealed(batchNumber);
        if (keccak256(abi.encodePacked(salt)) != b.saltHash) revert SaltMismatch(batchNumber);

        b.salt = salt;
        b.revealedAt = uint64(block.timestamp);

        emit BatchRevealed(batchNumber, salt, uint64(block.timestamp));
    }

    /// @notice Read everything publicly known about a batch.
    function getBatch(uint256 batchNumber)
        external
        view
        returns (
            uint256 vrfRequestId,
            uint256 randomness,
            bytes32 saltHash,
            bytes32 salt,
            bytes32 merkleRoot,
            uint64 requestedAt,
            uint64 fulfilledAt,
            uint64 rootCommittedAt,
            uint64 revealedAt,
            bool fulfilled,
            bool rootCommitted,
            bool revealed
        )
    {
        Batch memory b = _batches[batchNumber];
        return (
            b.vrfRequestId,
            b.randomness,
            b.saltHash,
            b.salt,
            b.merkleRoot,
            b.requestedAt,
            b.fulfilledAt,
            b.rootCommittedAt,
            b.revealedAt,
            b.fulfilledAt > 0,
            b.rootCommittedAt > 0,
            b.revealedAt > 0
        );
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
