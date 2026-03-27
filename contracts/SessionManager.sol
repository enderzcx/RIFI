// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

contract SessionManager {
    struct Session {
        address executor;
        uint256 maxPerTrade;
        uint256 totalBudget;
        uint256 spent;
        uint256 dailyLimit;
        uint256 dailySpent;
        uint256 dailyResetTime;
        uint256 expiry;
        uint256 maxSlippageBps;
        uint256 lastTradeTime;
        uint256 cooldownSeconds;
        uint256 maxActiveOrders;
        bool active;
    }

    IUniswapV2Router02 public immutable router;
    mapping(address => Session) public sessions;
    mapping(address => uint256) public activeOrderCount;

    // Allowed trading pairs: tokenA => tokenB => allowed
    mapping(address => mapping(address => bool)) public allowedPairs;

    event SessionCreated(address indexed user, address indexed executor, uint256 totalBudget, uint256 expiry);
    event SessionRevoked(address indexed user);
    event TradeExecuted(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event SessionExhausted(address indexed user, string reason);

    constructor(address _router) {
        router = IUniswapV2Router02(_router);
    }

    function createSession(
        address _executor,
        uint256 _totalBudget,
        uint256 _durationSeconds,
        address[] calldata _tokenPairs // [tokenA, tokenB, tokenC, tokenD, ...] pairs of 2
    ) external {
        require(_executor != address(0), "Invalid executor");
        require(_totalBudget > 0, "Zero budget");
        require(_durationSeconds > 0 && _durationSeconds <= 7 days, "Duration: 1s - 7d");

        // Defaults: 20% per trade, 50% daily, 2% slippage, 5min cooldown, max 3 orders
        sessions[msg.sender] = Session({
            executor: _executor,
            maxPerTrade: _totalBudget / 5,
            totalBudget: _totalBudget,
            spent: 0,
            dailyLimit: _totalBudget / 2,
            dailySpent: 0,
            dailyResetTime: block.timestamp + 1 days,
            expiry: block.timestamp + _durationSeconds,
            maxSlippageBps: 200, // 2%
            lastTradeTime: 0,
            cooldownSeconds: 300, // 5 min
            maxActiveOrders: 3,
            active: true
        });

        // Set allowed pairs
        for (uint256 i = 0; i + 1 < _tokenPairs.length; i += 2) {
            allowedPairs[_tokenPairs[i]][_tokenPairs[i + 1]] = true;
            allowedPairs[_tokenPairs[i + 1]][_tokenPairs[i]] = true; // bidirectional
        }

        emit SessionCreated(msg.sender, _executor, _totalBudget, block.timestamp + _durationSeconds);
    }

    function updateLimits(
        uint256 _maxPerTrade,
        uint256 _dailyLimit,
        uint256 _maxSlippageBps,
        uint256 _cooldownSeconds,
        uint256 _maxActiveOrders
    ) external {
        Session storage s = sessions[msg.sender];
        require(s.active, "No active session");
        if (_maxPerTrade > 0) s.maxPerTrade = _maxPerTrade;
        if (_dailyLimit > 0) s.dailyLimit = _dailyLimit;
        if (_maxSlippageBps > 0) s.maxSlippageBps = _maxSlippageBps;
        s.cooldownSeconds = _cooldownSeconds;
        if (_maxActiveOrders > 0) s.maxActiveOrders = _maxActiveOrders;
    }

    function revokeSession() external {
        sessions[msg.sender].active = false;
        emit SessionRevoked(msg.sender);
    }

    function executeSwap(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external returns (uint256 amountOut) {
        Session storage s = sessions[user];

        // --- All checks ---
        require(s.active, "No active session");
        require(msg.sender == s.executor, "Not executor");
        require(block.timestamp < s.expiry, "Session expired");
        require(allowedPairs[tokenIn][tokenOut], "Pair not allowed");
        require(amountIn <= s.maxPerTrade, "Exceeds max per trade");
        require(s.spent + amountIn <= s.totalBudget, "Budget exhausted");
        require(block.timestamp >= s.lastTradeTime + s.cooldownSeconds, "Cooldown active");

        // Daily limit reset
        if (block.timestamp >= s.dailyResetTime) {
            s.dailySpent = 0;
            s.dailyResetTime = block.timestamp + 1 days;
        }
        require(s.dailySpent + amountIn <= s.dailyLimit, "Daily limit reached");

        // --- Execute ---
        IERC20(tokenIn).transferFrom(user, address(this), amountIn);
        IERC20(tokenIn).approve(address(router), amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Slippage protection
        uint256[] memory expectedOut = router.getAmountsOut(amountIn, path);
        uint256 minOut = (expectedOut[1] * (10000 - s.maxSlippageBps)) / 10000;

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn,
            minOut,
            path,
            user, // tokens go directly back to user
            block.timestamp + 600
        );
        amountOut = amounts[1];

        // --- Update state ---
        s.spent += amountIn;
        s.dailySpent += amountIn;
        s.lastTradeTime = block.timestamp;

        emit TradeExecuted(user, tokenIn, tokenOut, amountIn, amountOut);

        // Check if budget nearly exhausted (< 5% remaining)
        if (s.totalBudget - s.spent < s.totalBudget / 20) {
            emit SessionExhausted(user, "Budget < 5% remaining");
        }
    }

    // --- Views ---

    function getSession(address user) external view returns (
        address executor,
        uint256 maxPerTrade,
        uint256 totalBudget,
        uint256 spent,
        uint256 remaining,
        uint256 dailyRemaining,
        uint256 expiry,
        bool active,
        bool expired
    ) {
        Session storage s = sessions[user];
        uint256 dailyR = s.dailySpent >= s.dailyLimit ? 0 : s.dailyLimit - s.dailySpent;
        if (block.timestamp >= s.dailyResetTime) dailyR = s.dailyLimit;

        return (
            s.executor,
            s.maxPerTrade,
            s.totalBudget,
            s.spent,
            s.totalBudget > s.spent ? s.totalBudget - s.spent : 0,
            dailyR,
            s.expiry,
            s.active,
            block.timestamp >= s.expiry
        );
    }

    function canExecute(address user, uint256 amount) external view returns (bool ok, string memory reason) {
        Session storage s = sessions[user];
        if (!s.active) return (false, "No active session");
        if (block.timestamp >= s.expiry) return (false, "Session expired");
        if (amount > s.maxPerTrade) return (false, "Exceeds max per trade");
        if (s.spent + amount > s.totalBudget) return (false, "Budget exhausted");
        if (block.timestamp < s.lastTradeTime + s.cooldownSeconds) return (false, "Cooldown active");
        uint256 ds = s.dailySpent;
        if (block.timestamp >= s.dailyResetTime) ds = 0;
        if (ds + amount > s.dailyLimit) return (false, "Daily limit reached");
        return (true, "");
    }
}
