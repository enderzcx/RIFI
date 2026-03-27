// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

import "reactive-lib/abstract-base/AbstractCallback.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "v2-periphery/interfaces/IUniswapV2Router02.sol";
import "v2-core/interfaces/IUniswapV2Pair.sol";

/**
 * @title ArbitrumStopOrderCallback
 * @notice Shared multi-user stop-loss / take-profit order manager deployed on Arbitrum (Chain 42161).
 *         Users create orders for any SushiSwap V2 pair; the companion Reactive contract
 *         (ArbitrumStopOrderReactive) monitors Sync events and calls executeStopOrder()
 *         via the Reactive Network callback proxy when a price threshold is crossed.
 *
 *         Every order can be triggered independently — the system supports unlimited
 *         concurrent orders per user/pair, each with its own threshold and retry logic.
 *
 * Deployment:
 *   _admin          -> admin wallet
 *   _callbackSender -> Arbitrum Callback Proxy: 0x4730c58FDA9d78f60c987039aEaB7d261aAd942E
 *   _router         -> SushiSwap V2 Router: 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506
 */
contract ArbitrumStopOrderCallback is AbstractCallback {
    using SafeERC20 for IERC20;

    // --- Events (Reactive contract subscribes to these by keccak256 topic) ---

    event StopOrderCreated(
        address indexed pair,
        uint256 indexed orderId,
        address indexed user,
        bool    sellToken0,
        address tokenSell,
        address tokenBuy,
        uint256 amount,
        uint256 coefficient,
        uint256 threshold,
        OrderType orderType
    );

    event StopOrderExecuted(
        address indexed pair,
        uint256 indexed orderId,
        address tokenSell,
        address tokenBuy,
        uint256 amountIn,
        uint256 amountOut
    );

    event StopOrderCancelled(uint256 indexed orderId);
    event StopOrderPaused   (uint256 indexed orderId);
    event StopOrderResumed  (uint256 indexed orderId);
    event SystemPaused      (bool paused);

    // --- Errors ---
    error Unauthorized();
    error SystemIsPaused();
    error OrderNotActive(uint256 orderId);
    error PriceConditionNotMet(uint256 orderId);
    error MaxRetriesExceeded(uint256 orderId);
    error InsufficientBalanceOrAllowance(uint256 orderId);

    // --- Enums ---
    enum OrderStatus { Active, Paused, Cancelled, Executed, Failed }
    enum OrderType   { StopLoss, TakeProfit }

    // --- Structs ---
    struct StopOrder {
        uint256 id;
        address user;
        address pair;
        address tokenSell;
        address tokenBuy;
        uint256 amount;
        bool    sellToken0;
        uint256 coefficient;
        uint256 threshold;
        uint16  slippageBps;   // e.g. 50 = 0.5%, 100 = 1% (max 1000 = 10%)
        OrderType   orderType;
        OrderStatus status;
        uint256 createdAt;
        uint256 executedAt;
        uint8   retryCount;
        uint256 lastExecutionAttempt;
    }

    // --- State ---
    address public immutable admin;
    IUniswapV2Router02 public immutable router;
    bool    public systemPaused;

    StopOrder[] public stopOrders;
    uint256     public nextOrderId;

    // --- Constants ---
    // SushiSwap V2 on Arbitrum charges 0.3% per swap (9970/10000)
    uint256 private constant SUSHI_FEE_NUMERATOR   = 9970;
    uint256 private constant SUSHI_FEE_DENOMINATOR  = 10000;
    uint256 private constant DEADLINE_OFFSET  = 300;   // 5-minute swap deadline
    uint8   private constant MAX_RETRIES      = 5;
    uint256 private constant RETRY_COOLDOWN   = 30;    // seconds between retries
    uint256 private constant MIN_AMOUNT       = 1000;  // dust guard
    uint16  private constant MAX_SLIPPAGE_BPS = 1000;  // 10% hard cap

    // --- Modifiers ---
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyOrderActor(uint256 orderId) {
        require(orderId < stopOrders.length, "Order does not exist");
        if (msg.sender != stopOrders[orderId].user && msg.sender != admin)
            revert Unauthorized();
        _;
    }

    modifier validOrder(uint256 orderId) {
        require(orderId < stopOrders.length, "Order does not exist");
        _;
    }

    modifier whenNotPaused() {
        if (systemPaused) revert SystemIsPaused();
        _;
    }

    // --- Constructor ---
    constructor(
        address _admin,
        address _callbackSender,   // 0x4730c58FDA9d78f60c987039aEaB7d261aAd942E
        address _router            // 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506
    ) payable AbstractCallback(_callbackSender) {
        admin  = _admin;
        router = IUniswapV2Router02(_router);
    }

    // --- User: create order ---

    /**
     * @notice Create a new stop-loss or take-profit order.
     * @dev    User must approve this contract for `amount` of tokenSell BEFORE calling.
     *         Each order is independently tracked and triggered — you can have multiple
     *         orders on the same pair at different thresholds.
     */
    function createStopOrder(
        address   pair,
        bool      sellToken0,
        uint256   amount,
        uint256   coefficient,
        uint256   threshold,
        OrderType orderType,
        uint16    slippageBps
    ) external whenNotPaused returns (uint256 orderId) {
        require(pair        != address(0), "Invalid pair");
        require(amount      >= MIN_AMOUNT, "Amount too small");
        require(coefficient  > 0,          "Zero coefficient");
        require(threshold    > 0,          "Zero threshold");
        require(slippageBps <= MAX_SLIPPAGE_BPS, "Slippage too high");

        address token0    = IUniswapV2Pair(pair).token0();
        address token1    = IUniswapV2Pair(pair).token1();
        address tokenSell = sellToken0 ? token0 : token1;
        address tokenBuy  = sellToken0 ? token1 : token0;

        require(IERC20(tokenSell).balanceOf(msg.sender)                >= amount, "Insufficient balance");
        require(IERC20(tokenSell).allowance(msg.sender, address(this)) >= amount, "Insufficient allowance");

        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        require(r0 > 0 && r1 > 0, "Pair has no liquidity");

        orderId = nextOrderId++;
        stopOrders.push(StopOrder({
            id:                   orderId,
            user:                 msg.sender,
            pair:                 pair,
            tokenSell:            tokenSell,
            tokenBuy:             tokenBuy,
            amount:               amount,
            sellToken0:           sellToken0,
            coefficient:          coefficient,
            threshold:            threshold,
            slippageBps:          slippageBps,
            orderType:            orderType,
            status:               OrderStatus.Active,
            createdAt:            block.timestamp,
            executedAt:           0,
            retryCount:           0,
            lastExecutionAttempt: 0
        }));

        emit StopOrderCreated(
            pair, orderId, msg.sender,
            sellToken0, tokenSell, tokenBuy,
            amount, coefficient, threshold, orderType
        );
    }

    // --- User: manage orders ---

    function cancelStopOrder(uint256 orderId) external onlyOrderActor(orderId) {
        StopOrder storage o = stopOrders[orderId];
        require(o.status == OrderStatus.Active || o.status == OrderStatus.Paused, "Cannot cancel");
        o.status = OrderStatus.Cancelled;
        emit StopOrderCancelled(orderId);
    }

    function pauseStopOrder(uint256 orderId) external onlyOrderActor(orderId) {
        StopOrder storage o = stopOrders[orderId];
        require(o.status == OrderStatus.Active, "Not active");
        o.status = OrderStatus.Paused;
        emit StopOrderPaused(orderId);
    }

    function resumeStopOrder(uint256 orderId) external onlyOrderActor(orderId) {
        StopOrder storage o = stopOrders[orderId];
        require(o.status == OrderStatus.Paused, "Not paused");
        o.status = OrderStatus.Active;
        emit StopOrderResumed(orderId);
    }

    // --- Reactive callback: execute order ---

    function executeStopOrder(
        address, /* sender — unused, verified via authorizedSenderOnly */
        uint256 orderId
    ) external authorizedSenderOnly validOrder(orderId) {
        StopOrder storage o = stopOrders[orderId];

        if (o.status != OrderStatus.Active) revert OrderNotActive(orderId);

        // On-chain price double-check
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(o.pair).getReserves();
        if (!_isPriceConditionMet(o.sellToken0, r0, r1, o.coefficient, o.threshold, o.orderType)) {
            revert PriceConditionNotMet(orderId);
        }

        // Retry cooldown
        if (o.lastExecutionAttempt > 0 &&
            block.timestamp < o.lastExecutionAttempt + RETRY_COOLDOWN) {
            return;
        }

        if (o.retryCount >= MAX_RETRIES) {
            o.status = OrderStatus.Failed;
            revert MaxRetriesExceeded(orderId);
        }

        o.lastExecutionAttempt = block.timestamp;
        o.retryCount++;

        // Balance & allowance check
        uint256 balance   = IERC20(o.tokenSell).balanceOf(o.user);
        uint256 allowance = IERC20(o.tokenSell).allowance(o.user, address(this));
        uint256 execAmt   = Math.min(o.amount, Math.min(balance, allowance));

        if (execAmt < MIN_AMOUNT) {
            o.status = OrderStatus.Failed;
            revert InsufficientBalanceOrAllowance(orderId);
        }

        // Execute swap
        uint256 amountOut = _executeSwap(o, execAmt, r0, r1);

        o.status     = OrderStatus.Executed;
        o.executedAt = block.timestamp;

        emit StopOrderExecuted(o.pair, orderId, o.tokenSell, o.tokenBuy, execAmt, amountOut);
    }

    // --- Admin ---

    function setSystemPaused(bool _paused) external onlyAdmin {
        systemPaused = _paused;
        emit SystemPaused(_paused);
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyAdmin {
        IERC20(token).safeTransfer(to, amount);
    }

    function rescueETH(address payable to, uint256 amount) external onlyAdmin {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    // --- View helpers ---

    function getOrder(uint256 orderId) external view validOrder(orderId) returns (StopOrder memory) {
        return stopOrders[orderId];
    }

    function totalOrders() external view returns (uint256) {
        return stopOrders.length;
    }

    function getUserOrderIds(address user) external view returns (uint256[] memory ids) {
        uint256 count;
        for (uint256 i; i < stopOrders.length; i++) {
            if (stopOrders[i].user == user) count++;
        }
        ids = new uint256[](count);
        uint256 idx;
        for (uint256 i; i < stopOrders.length; i++) {
            if (stopOrders[i].user == user) ids[idx++] = i;
        }
    }

    function getCurrentPrice(address pair, bool sellToken0) external view returns (uint256) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        require(r0 > 0 && r1 > 0, "No liquidity");
        return sellToken0
            ? Math.mulDiv(uint256(r1), 1e6, uint256(r0))
            : Math.mulDiv(uint256(r0), 1e6, uint256(r1));
    }

    // --- Internal ---

    function _executeSwap(
        StopOrder memory o,
        uint256 amount,
        uint112 reserve0,
        uint112 reserve1
    ) internal returns (uint256 amountOut) {
        (uint112 reserveIn, uint112 reserveOut) = o.sellToken0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);

        uint256 expectedOut  = _getAmountOut(amount, uint256(reserveIn), uint256(reserveOut));
        uint256 minAmountOut = expectedOut * (10000 - o.slippageBps) / 10000;

        IERC20(o.tokenSell).safeTransferFrom(o.user, address(this), amount);
        IERC20(o.tokenSell).forceApprove(address(router), amount);

        address[] memory path = new address[](2);
        path[0] = o.tokenSell;
        path[1] = o.tokenBuy;

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amount,
            minAmountOut,
            path,
            o.user,
            block.timestamp + DEADLINE_OFFSET
        );
        amountOut = amounts[amounts.length - 1];
    }

    /// @dev SushiSwap V2 getAmountOut formula (0.3% fee = 9970/10000).
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * SUSHI_FEE_NUMERATOR;
        uint256 numerator       = amountInWithFee * reserveOut;
        uint256 denominator     = reserveIn * SUSHI_FEE_DENOMINATOR + amountInWithFee;
        return numerator / denominator;
    }

    function _isPriceConditionMet(
        bool    sellToken0,
        uint112 reserve0,
        uint112 reserve1,
        uint256 coefficient,
        uint256 threshold,
        OrderType orderType
    ) internal pure returns (bool) {
        uint256 price = sellToken0
            ? Math.mulDiv(uint256(reserve1), coefficient, uint256(reserve0))
            : Math.mulDiv(uint256(reserve0), coefficient, uint256(reserve1));

        return orderType == OrderType.StopLoss
            ? price <= threshold
            : price >= threshold;
    }
}
