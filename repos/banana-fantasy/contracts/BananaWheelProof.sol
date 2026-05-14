// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BananaWheelProof — VRF v2.5 randomness + commit/reveal salt + Merkle root
/// @notice Provably-fair Banana Wheel spin outcomes. Mirrors BBB4BatchProofVRFCommit
///   for the salt+VRF primitives but adds a Merkle-root commitment so that every
///   individual spin within a period is independently verifiable (instant proof
///   in the browser) — without revealing the salt mid-period.
///
///   Lifecycle per period:
///     1. `requestRandomnessAndCommit(periodNumber, saltHash)` — atomic commit
///        of salt-hash + VRF request. Salt stays sealed off-chain.
///     2. VRF coordinator fulfills (`rawFulfillRandomWords`). Server pre-computes
///        all outcomes for the period via `pickWeighted(segments, sha256(salt || randomness || i))`
///        and builds a Merkle tree of (spinIndex, outcomeId) leaves.
///     3. `commitMerkleRoot(periodNumber, root)` — owner commits the root.
///        From this moment, the period accepts spins and each spin gets a
///        Merkle proof verifiable against `root`.
///     4. At period close (after N spins or X days), `revealSalt(periodNumber, salt)` —
///        verifies keccak256(salt) == saltHash, stores salt on-chain. Anyone can
///        now re-derive every outcome from scratch and confirm the Merkle root.
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

contract BananaWheelProof {
    // ───── ownership ─────────────────────────────────────────────────────
    address public owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotCoordinator();
    error ZeroAddress();
    error ZeroHash();
    error AlreadyRequested(uint256 periodNumber);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 periodNumber);
    error NotFulfilled(uint256 periodNumber);
    error AlreadyCommitted(uint256 periodNumber);
    error RootNotCommitted(uint256 periodNumber);
    error AlreadyRevealed(uint256 periodNumber);
    error SaltMismatch(uint256 periodNumber);
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

    // ───── per-period state ──────────────────────────────────────────────
    struct Period {
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

    mapping(uint256 => Period) private _periods;
    mapping(uint256 => uint256) private _requestToPeriod;

    event PeriodRequested(
        uint256 indexed periodNumber,
        uint256 indexed requestId,
        bytes32 saltHash,
        uint64 requestedAt
    );
    event PeriodFulfilled(
        uint256 indexed periodNumber,
        uint256 indexed requestId,
        uint256 randomness,
        uint64 fulfilledAt
    );
    event PeriodRootCommitted(
        uint256 indexed periodNumber,
        bytes32 merkleRoot,
        uint64 rootCommittedAt
    );
    event PeriodRevealed(
        uint256 indexed periodNumber,
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

    /// @notice Step 1: atomically commit a salt hash and request VRF randomness for `periodNumber`.
    function requestRandomnessAndCommit(uint256 periodNumber, bytes32 saltHash)
        external
        onlyOwner
        returns (uint256 requestId)
    {
        if (_periods[periodNumber].vrfRequestId != 0) revert AlreadyRequested(periodNumber);
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

        _periods[periodNumber] = Period({
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
        _requestToPeriod[requestId] = periodNumber;

        emit PeriodRequested(periodNumber, requestId, saltHash, uint64(block.timestamp));
    }

    /// @notice Step 2 (coordinator callback): records the VRF random word.
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != vrfCoordinator) revert NotCoordinator();
        uint256 periodNumber = _requestToPeriod[requestId];
        if (periodNumber == 0) revert UnknownRequest(requestId);
        if (_periods[periodNumber].fulfilledAt != 0) revert AlreadyFulfilled(periodNumber);
        if (randomWords.length == 0) revert NoRandomWords();

        _periods[periodNumber].randomness = randomWords[0];
        _periods[periodNumber].fulfilledAt = uint64(block.timestamp);

        emit PeriodFulfilled(periodNumber, requestId, randomWords[0], uint64(block.timestamp));
    }

    /// @notice Step 3: owner commits the Merkle root of the period's pre-computed outcomes.
    ///   Must be called after `rawFulfillRandomWords`. Once committed, the period is
    ///   "active" — spins consume pre-derived outcomes and receive Merkle proofs.
    function commitMerkleRoot(uint256 periodNumber, bytes32 root) external onlyOwner {
        Period storage p = _periods[periodNumber];
        if (p.fulfilledAt == 0) revert NotFulfilled(periodNumber);
        if (p.rootCommittedAt != 0) revert AlreadyCommitted(periodNumber);
        if (root == bytes32(0)) revert ZeroHash();

        p.merkleRoot = root;
        p.rootCommittedAt = uint64(block.timestamp);

        emit PeriodRootCommitted(periodNumber, root, uint64(block.timestamp));
    }

    /// @notice Step 4: reveal the salt at period close. Verifies keccak256(salt) == saltHash
    ///   so the public can re-derive every outcome and confirm the Merkle root from scratch.
    function revealSalt(uint256 periodNumber, bytes32 salt) external onlyOwner {
        Period storage p = _periods[periodNumber];
        if (p.rootCommittedAt == 0) revert RootNotCommitted(periodNumber);
        if (p.revealedAt != 0) revert AlreadyRevealed(periodNumber);
        if (keccak256(abi.encodePacked(salt)) != p.saltHash) revert SaltMismatch(periodNumber);

        p.salt = salt;
        p.revealedAt = uint64(block.timestamp);

        emit PeriodRevealed(periodNumber, salt, uint64(block.timestamp));
    }

    /// @notice Read everything publicly known about a period.
    function getPeriod(uint256 periodNumber)
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
        Period memory p = _periods[periodNumber];
        return (
            p.vrfRequestId,
            p.randomness,
            p.saltHash,
            p.salt,
            p.merkleRoot,
            p.requestedAt,
            p.fulfilledAt,
            p.rootCommittedAt,
            p.revealedAt,
            p.fulfilledAt > 0,
            p.rootCommittedAt > 0,
            p.revealedAt > 0
        );
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
