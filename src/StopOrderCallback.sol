// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import "reactive-lib/abstract-base/AbstractCallback.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IOrderRegistry {
    function markExecutedAndCancelLinked(uint256 orderId) external;
    function verifyOrder(uint256 orderId, address pair, address client, uint256 amount)
        external view returns (bool);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

/// @title StopOrderCallback — Executes stop-loss / take-profit swaps on Base
/// @notice Handles price verification, balance checks, and swap execution with
///         configurable slippage and graceful failure handling.
contract StopOrderCallback is AbstractCallback {
    using SafeERC20 for IERC20;

    IUniswapV2Router02 public immutable router;
    IOrderRegistry     public immutable registry;

    /// @notice Slippage tolerance in basis points (e.g., 100 = 1%, 50 = 0.5%)
    uint256 public slippageBps;

    /// @notice Maximum allowed slippage: 10%
    uint256 private constant MAX_SLIPPAGE_BPS = 1000;

    /// @notice Swap deadline offset in seconds
    uint256 private constant DEADLINE_OFFSET = 300;

    address public owner;

    event Executed(
        uint256 indexed orderId,
        address indexed pair,
        address indexed client,
        address tokenSold,
        uint256 amountIn,
        uint256 amountOut
    );

    event ExecutionFailed(
        uint256 indexed orderId,
        address indexed client,
        string  reason
    );

    event SlippageUpdated(uint256 oldBps, uint256 newBps);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(
        address _callbackProxy,
        address _router,
        address _registry,
        uint256 _slippageBps
    ) AbstractCallback(_callbackProxy) payable {
        require(_slippageBps <= MAX_SLIPPAGE_BPS, "Slippage too high");
        router      = IUniswapV2Router02(_router);
        registry    = IOrderRegistry(_registry);
        slippageBps = _slippageBps;
        owner       = msg.sender;
    }

    /// @notice Update slippage tolerance (owner only)
    function setSlippage(uint256 _slippageBps) external onlyOwner {
        require(_slippageBps <= MAX_SLIPPAGE_BPS, "Slippage too high");
        emit SlippageUpdated(slippageBps, _slippageBps);
        slippageBps = _slippageBps;
    }

    function execute(
        address,            // rvmId
        address pair,
        address client,
        bool    sellToken0,
        bool    isStopLoss,
        uint256 amount,
        uint256 coefficient,
        uint256 threshold,
        uint256 orderId
    ) external authorizedSenderOnly {

        // 1. Verify order is still active in registry
        if (!registry.verifyOrder(orderId, pair, client, amount)) {
            emit ExecutionFailed(orderId, client, "Order verification failed");
            return;
        }

        // 2. Double-check price condition on Base (guards against Reactive→Base delay)
        IUniswapV2Pair pairContract = IUniswapV2Pair(pair);
        (uint112 r0, uint112 r1,) = pairContract.getReserves();

        bool priceOk;
        if (sellToken0) {
            uint256 val = uint256(r1) * coefficient / uint256(r0);
            priceOk = isStopLoss ? (val <= threshold) : (val >= threshold);
        } else {
            uint256 val = uint256(r0) * coefficient / uint256(r1);
            priceOk = isStopLoss ? (val <= threshold) : (val >= threshold);
        }

        if (!priceOk) {
            emit ExecutionFailed(orderId, client, "Price not met");
            return;
        }

        address token0 = pairContract.token0();
        address token1 = pairContract.token1();
        address tokenSell = sellToken0 ? token0 : token1;
        address tokenBuy  = sellToken0 ? token1 : token0;

        // 3. Check both allowance AND balance before attempting transfer (graceful fail)
        uint256 allowance = IERC20(tokenSell).allowance(client, address(this));
        if (allowance < amount) {
            emit ExecutionFailed(orderId, client, "Insufficient allowance");
            return;
        }

        uint256 balance = IERC20(tokenSell).balanceOf(client);
        if (balance < amount) {
            emit ExecutionFailed(orderId, client, "Insufficient balance");
            return;
        }

        // 4. Transfer tokens from user to this contract
        IERC20(tokenSell).safeTransferFrom(client, address(this), amount);
        IERC20(tokenSell).forceApprove(address(router), amount);

        // 5. Calculate minAmountOut with configurable slippage
        uint256 reserveIn  = sellToken0 ? uint256(r0) : uint256(r1);
        uint256 reserveOut = sellToken0 ? uint256(r1) : uint256(r0);
        uint256 amountInWithFee = amount * 997;
        uint256 expectedOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
        uint256 amountOutMin = expectedOut * (10000 - slippageBps) / 10000;

        address[] memory path = new address[](2);
        path[0] = tokenSell;
        path[1] = tokenBuy;

        // 6. Execute swap with try-catch: if swap reverts, return tokens to user
        try router.swapExactTokensForTokens(
            amount,
            amountOutMin,
            path,
            client,
            block.timestamp + DEADLINE_OFFSET
        ) returns (uint256[] memory amounts) {
            // Success: mark order executed and cancel linked OCO order
            registry.markExecutedAndCancelLinked(orderId);
            emit Executed(orderId, pair, client, tokenSell, amounts[0], amounts[1]);
        } catch {
            // Swap failed (slippage, liquidity, etc.): return tokens to user
            IERC20(tokenSell).safeTransfer(client, amount);
            emit ExecutionFailed(orderId, client, "Swap failed (slippage or liquidity)");
        }
    }
}
