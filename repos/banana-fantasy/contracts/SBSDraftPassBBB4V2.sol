// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SBSDraftPassBBB4V2
 * @notice ERC-721 Draft Pass for BBB4. Paid mints require USDC approval.
 *
 * V2 = V1 (0x14065412b3A431a660e6E576A14b104F1b3E463b) plus ONE addition:
 * the OpenSea conduit is pre-approved as an operator for every holder, so
 * listing and accepting offers on the SBS marketplace never require a
 * setApprovalForAll transaction (which an external wallet would pay gas
 * for). Sales still require a holder-signed Seaport order — the conduit
 * cannot move tokens on its own. An owner kill-switch revokes the blanket
 * approval instantly if the conduit were ever compromised, restoring
 * standard per-holder approvals.
 */
contract SBSDraftPassBBB4V2 is ERC721, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Constants ---
    uint256 public constant TOKEN_PRICE_USDC = 25 * 1e6; // USDC has 6 decimals
    uint256 public constant MAX_TOKENS_PER_TX = 20;
    /// @notice OpenSea's cross-chain Seaport conduit (same address on Base).
    address public constant OPENSEA_CONDUIT = 0x1E0049783F008A0085193E00003D00cd54003c71;

    // --- State ---
    string private baseURI;
    IERC20 public usdc;
    uint256 public totalMinted;

    /// @notice When true (default), the OpenSea conduit is approved for all
    /// holders. Owner can disable to fall back to standard approvals.
    bool public conduitApprovalEnabled = true;

    // Public mint
    bool public mintIsActive;

    // Wallet-based presale mint
    bool public presaleIsActive;
    mapping(address => bool) public presaleWalletList;

    // Free wallet-based mint
    bool public freeWalletIsActive;
    mapping(address => bool) public freeWalletList;

    event ConduitApprovalToggled(bool enabled);

    /// @param name_ Collection name — "BBB4 Staging" on staging, the real
    /// collection name at prod launch. Parameterized so the IDENTICAL source
    /// deploys to both environments with only constructor args changing.
    constructor(string memory name_, string memory symbol_, address initialUSDCAddress)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {
        require(initialUSDCAddress != address(0), "USDC address required");
        usdc = IERC20(initialUSDCAddress);
    }

    // --- Marketplace operator auto-approval ---
    function setConduitApprovalEnabled(bool enabled) external onlyOwner {
        conduitApprovalEnabled = enabled;
        emit ConduitApprovalToggled(enabled);
    }

    /// @dev The conduit reads as approved for every holder while the switch
    /// is on; everything else behaves exactly like stock ERC721.
    function isApprovedForAll(address holder, address operator)
        public
        view
        override
        returns (bool)
    {
        if (conduitApprovalEnabled && operator == OPENSEA_CONDUIT) {
            return true;
        }
        return super.isApprovedForAll(holder, operator);
    }

    // --- Minting ---
    function flipMintState() external onlyOwner {
        mintIsActive = !mintIsActive;
    }

    function mint(uint256 numberOfTokens) external nonReentrant {
        require(mintIsActive, "Mint is not active");
        _paidMint(msg.sender, numberOfTokens);
    }

    function flipPresaleState() external onlyOwner {
        presaleIsActive = !presaleIsActive;
    }

    function initPresaleWalletList(address[] calldata walletList) external onlyOwner {
        for (uint256 i = 0; i < walletList.length; i++) {
            presaleWalletList[walletList[i]] = true;
        }
    }

    function mintPresaleWalletList(uint256 numberOfTokens) external nonReentrant {
        require(presaleIsActive, "Mint is not active");
        require(presaleWalletList[msg.sender], "Not on presale list or already minted");
        _paidMint(msg.sender, numberOfTokens);
        presaleWalletList[msg.sender] = false; // one-time access
    }

    function flipFreeWalletState() external onlyOwner {
        freeWalletIsActive = !freeWalletIsActive;
    }

    function initFreeWalletList(address[] calldata walletList) external onlyOwner {
        for (uint256 i = 0; i < walletList.length; i++) {
            freeWalletList[walletList[i]] = true;
        }
    }

    function mintFreeWalletList() external nonReentrant {
        require(freeWalletIsActive, "Mint is not active");
        require(freeWalletList[msg.sender], "Not on free list or already minted");
        _mintSequential(msg.sender, 1);
        freeWalletList[msg.sender] = false; // one-time access
    }

    // Owner reserve mint (team/promos)
    function reserveTokens(address to, uint256 numberOfTokens) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(numberOfTokens > 0, "Invalid quantity");
        _mintSequential(to, numberOfTokens);
    }

    // --- Admin ---
    function withdrawUSDC() external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        usdc.safeTransfer(owner(), balance);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        baseURI = uri;
    }

    function setPaused(bool setPaused) external onlyOwner {
        if (setPaused) {
            _pause();
        } else {
            _unpause();
        }
    }

    function setUSDCAddress(address newUSDCAddress) external onlyOwner {
        require(newUSDCAddress != address(0), "USDC address required");
        usdc = IERC20(newUSDCAddress);
    }

    // --- Views ---
    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    // --- Internals ---
    function _paidMint(address to, uint256 numberOfTokens) internal {
        require(numberOfTokens > 0, "Invalid quantity");
        require(numberOfTokens <= MAX_TOKENS_PER_TX, "Over max per transaction");

        uint256 totalCost = TOKEN_PRICE_USDC * numberOfTokens;
        usdc.safeTransferFrom(msg.sender, address(this), totalCost);

        _mintSequential(to, numberOfTokens);
    }

    function _mintSequential(address to, uint256 numberOfTokens) internal {
        for (uint256 i = 0; i < numberOfTokens; i++) {
            _safeMint(to, totalMinted);
            totalMinted++;
        }
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
}
