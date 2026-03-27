// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title SessionVault — Limited-scope session key for AI autonomous trading
/// @notice User grants a session key (backend wallet) permission to trade
///         within constraints: max amount per trade, total budget, expiry.
///         AI operates within these bounds without further user signatures.
contract SessionVault {

    struct Session {
        address operator;       // Backend wallet (AI executor)
        address token;          // Token the operator can spend (e.g., WETH)
        uint256 maxPerTrade;    // Max amount per single trade
        uint256 totalBudget;    // Total spending limit for this session
        uint256 spent;          // Amount already spent
        uint256 expiresAt;      // Unix timestamp expiry
        bool    active;
    }

    mapping(address => Session) public sessions; // user => session
    mapping(address => mapping(address => bool)) public approvedContracts; // user => contract => approved

    event SessionCreated(
        address indexed user,
        address indexed operator,
        address token,
        uint256 maxPerTrade,
        uint256 totalBudget,
        uint256 expiresAt
    );

    event SessionRevoked(address indexed user);

    event TradeExecuted(
        address indexed user,
        address indexed operator,
        uint256 amount,
        uint256 remaining
    );

    /// @notice User creates a session granting operator limited trading rights
    function createSession(
        address operator,
        address token,
        uint256 maxPerTrade,
        uint256 totalBudget,
        uint256 durationSeconds
    ) external {
        require(operator != address(0), "Invalid operator");
        require(totalBudget > 0, "Budget must be > 0");

        sessions[msg.sender] = Session({
            operator:    operator,
            token:       token,
            maxPerTrade: maxPerTrade,
            totalBudget: totalBudget,
            spent:       0,
            expiresAt:   block.timestamp + durationSeconds,
            active:      true
        });

        emit SessionCreated(msg.sender, operator, token, maxPerTrade, totalBudget, block.timestamp + durationSeconds);
    }

    /// @notice User revokes the session immediately
    function revokeSession() external {
        sessions[msg.sender].active = false;
        emit SessionRevoked(msg.sender);
    }

    /// @notice User approves a contract (e.g., OrderRegistry, Router) for the operator to call on their behalf
    function approveContract(address contractAddr, bool approved) external {
        approvedContracts[msg.sender][contractAddr] = approved;
    }

    /// @notice Operator spends from user's session budget.
    ///         Called by backend before executing a trade.
    function spendFromSession(address user, uint256 amount) external returns (bool) {
        Session storage s = sessions[user];

        require(s.active, "Session not active");
        require(msg.sender == s.operator, "Not operator");
        require(block.timestamp < s.expiresAt, "Session expired");
        require(amount <= s.maxPerTrade, "Exceeds per-trade limit");
        require(s.spent + amount <= s.totalBudget, "Exceeds total budget");

        s.spent += amount;

        emit TradeExecuted(user, msg.sender, amount, s.totalBudget - s.spent);
        return true;
    }

    /// @notice Check remaining budget
    function remainingBudget(address user) external view returns (uint256) {
        Session storage s = sessions[user];
        if (!s.active || block.timestamp >= s.expiresAt) return 0;
        return s.totalBudget - s.spent;
    }

    /// @notice Check if session is valid
    function isSessionValid(address user) external view returns (bool) {
        Session storage s = sessions[user];
        return s.active && block.timestamp < s.expiresAt && s.spent < s.totalBudget;
    }
}
