// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import "reactive-lib/abstract-base/AbstractCallback.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
contract StopOrderCallback is AbstractCallback {

    IUniswapV2Router02 public immutable router;
    IOrderRegistry     public immutable registry;

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

    constructor(
        address _callbackProxy,
        address _router,
        address _registry
    ) AbstractCallback(_callbackProxy) payable {
        router   = IUniswapV2Router02(_router);
        registry = IOrderRegistry(_registry);
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

        if (!registry.verifyOrder(orderId, pair, client, amount)) {
            emit ExecutionFailed(orderId, client, "Order verification failed");
            return;
        }

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

        uint256 allowance = IERC20(tokenSell).allowance(client, address(this));
        if (allowance < amount) {
            emit ExecutionFailed(orderId, client, "Insufficient allowance");
            return;
        }

        require(IERC20(tokenSell).transferFrom(client, address(this), amount), "Transfer failed");

        IERC20(tokenSell).approve(address(router), amount);

        uint256 reserveIn  = sellToken0 ? uint256(r0) : uint256(r1);
        uint256 reserveOut = sellToken0 ? uint256(r1) : uint256(r0);
        uint256 amountInWithFee = amount * 997;
        uint256 expectedOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
        uint256 amountOutMin = expectedOut * 995 / 1000; // 0.5% slippage

        address[] memory path = new address[](2);
        path[0] = tokenSell;
        path[1] = tokenBuy;

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amount,
            amountOutMin,
            path,
            client,
            block.timestamp + 300
        );

        registry.markExecutedAndCancelLinked(orderId);

        emit Executed(orderId, pair, client, tokenSell, amounts[0], amounts[1]);
    }
}
