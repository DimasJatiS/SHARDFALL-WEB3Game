// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MatchEscrow — holds Shardfall match tickets and pays the top 3.
/// @notice One match = createMatch (operator) → joinMatch (each player) → settleMatch (operator).
///         The map seed hash is committed at creation and revealed at settlement, so anyone can
///         check the map was not changed mid-match. The game server never holds player funds.
contract MatchEscrow is Ownable, ReentrancyGuard {
    uint8 public constant MIN_PLAYERS = 3;
    uint16 public constant FEE_BPS = 500; // 5% to treasury
    uint16 public constant BPS = 10_000;
    /// @dev Fewer than MIN_PLAYERS after this → players may refund.
    uint256 public constant LOBBY_TIMEOUT = 2 minutes;
    /// @dev Not settled after this → players may refund; settlement is closed.
    uint256 public constant SETTLE_TIMEOUT = 15 minutes;

    struct Match {
        uint96 entryFee;
        uint8 maxPlayers;
        uint8 playerCount;
        bool settled;
        uint40 createdAt;
        bytes32 seedHash;
    }

    address public operator;
    address public treasury;
    mapping(bytes32 => Match) public matches;
    mapping(bytes32 => mapping(address => bool)) public isPlayer;
    mapping(bytes32 => mapping(address => bool)) public refunded;

    event MatchCreated(bytes32 indexed matchId, uint96 entryFee, bytes32 seedHash);
    event PlayerJoined(bytes32 indexed matchId, address indexed player);
    event MatchSettled(bytes32 indexed matchId, address[3] top3, uint256[3] prizes, bytes32 seed);
    event Refunded(bytes32 indexed matchId, address indexed player, uint256 amount);
    event OperatorChanged(address operator);
    event TreasuryChanged(address treasury);

    error NotOperator();
    error MatchExists();
    error UnknownMatch();
    error BadParams();
    error WrongFee();
    error AlreadyJoined();
    error MatchFull();
    error AlreadySettled();
    error NotEnoughPlayers();
    error BadSeed();
    error BadWinners();
    error SettleWindowClosed();
    error RefundNotAvailable();
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address operator_, address treasury_) Ownable(msg.sender) {
        if (operator_ == address(0) || treasury_ == address(0)) revert BadParams();
        operator = operator_;
        treasury = treasury_;
    }

    // ------------------------------------------------------------------ admin

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert BadParams();
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert BadParams();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    // ------------------------------------------------------------------ match lifecycle

    /// @param seedHash keccak256(seed), committed before anyone joins.
    function createMatch(bytes32 matchId, uint96 entryFee, uint8 maxPlayers, bytes32 seedHash) external onlyOperator {
        if (matches[matchId].createdAt != 0) revert MatchExists();
        if (entryFee == 0 || maxPlayers < MIN_PLAYERS || seedHash == bytes32(0)) revert BadParams();
        matches[matchId] = Match({
            entryFee: entryFee,
            maxPlayers: maxPlayers,
            playerCount: 0,
            settled: false,
            createdAt: uint40(block.timestamp),
            seedHash: seedHash
        });
        emit MatchCreated(matchId, entryFee, seedHash);
    }

    function joinMatch(bytes32 matchId) external payable {
        Match storage m = matches[matchId];
        if (m.createdAt == 0) revert UnknownMatch();
        if (m.settled) revert AlreadySettled();
        if (block.timestamp >= m.createdAt + SETTLE_TIMEOUT) revert SettleWindowClosed();
        if (msg.value != m.entryFee) revert WrongFee();
        if (isPlayer[matchId][msg.sender]) revert AlreadyJoined();
        if (m.playerCount >= m.maxPlayers) revert MatchFull();
        isPlayer[matchId][msg.sender] = true;
        m.playerCount++;
        emit PlayerJoined(matchId, msg.sender);
    }

    /// @notice Reveal the seed and pay the top 3: 5% fee, then 60/25/15 of the rest.
    function settleMatch(bytes32 matchId, address[3] calldata top3, bytes32 seed) external onlyOperator nonReentrant {
        Match storage m = matches[matchId];
        if (m.createdAt == 0) revert UnknownMatch();
        if (m.settled) revert AlreadySettled();
        if (block.timestamp >= m.createdAt + SETTLE_TIMEOUT) revert SettleWindowClosed();
        if (m.playerCount < MIN_PLAYERS) revert NotEnoughPlayers();
        if (keccak256(abi.encodePacked(seed)) != m.seedHash) revert BadSeed();
        for (uint256 i = 0; i < 3; i++) {
            if (!isPlayer[matchId][top3[i]]) revert BadWinners();
            for (uint256 j = 0; j < i; j++) if (top3[i] == top3[j]) revert BadWinners();
        }

        m.settled = true;

        uint256 pool = uint256(m.entryFee) * m.playerCount;
        uint256 net = pool - (pool * FEE_BPS) / BPS;
        uint256[3] memory prizes = [(net * 6000) / BPS, (net * 2500) / BPS, (net * 1500) / BPS];
        // Fee plus rounding dust goes to the treasury.
        uint256 toTreasury = pool - prizes[0] - prizes[1] - prizes[2];

        emit MatchSettled(matchId, top3, prizes, seed);
        for (uint256 i = 0; i < 3; i++) _send(top3[i], prizes[i]);
        _send(treasury, toTreasury);
    }

    /// @notice Get your ticket back if the lobby never filled or the match was never settled.
    function refund(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (!refundAvailable(matchId)) revert RefundNotAvailable();
        if (!isPlayer[matchId][msg.sender] || refunded[matchId][msg.sender]) revert RefundNotAvailable();
        refunded[matchId][msg.sender] = true;
        emit Refunded(matchId, msg.sender, m.entryFee);
        _send(msg.sender, m.entryFee);
    }

    // ------------------------------------------------------------------ views

    function refundAvailable(bytes32 matchId) public view returns (bool) {
        Match storage m = matches[matchId];
        if (m.createdAt == 0 || m.settled) return false;
        bool lobbyFailed = m.playerCount < MIN_PLAYERS && block.timestamp >= m.createdAt + LOBBY_TIMEOUT;
        bool neverSettled = block.timestamp >= m.createdAt + SETTLE_TIMEOUT;
        return lobbyFailed || neverSettled;
    }

    function playerCount(bytes32 matchId) external view returns (uint8) {
        return matches[matchId].playerCount;
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
