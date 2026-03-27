// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumStopOrderCallback.sol";
import "../src/ArbitrumStopOrderReactive.sol";

// ============================================================================
// Two-step deployment:
//
//   Step 1 — Deploy ArbitrumStopOrderCallback on Arbitrum (42161):
//     forge script script/DeployArbitrumStopOrder.s.sol:DeployCallback \
//       --rpc-url $ARBITRUM_RPC --private-key $ARBITRUM_WALLET_PRIVATEKEY \
//       --broadcast -vvvv
//
//     → Copy printed address → set CALLBACK_CONTRACT in .env
//
//   Step 2 — Deploy ArbitrumStopOrderReactive on Reactive Mainnet (1597):
//     forge script script/DeployArbitrumStopOrder.s.sol:DeployReactive \
//       --rpc-url $REACTIVE_RPC --private-key $ARBITRUM_WALLET_PRIVATEKEY \
//       --broadcast -vvvv
// ============================================================================

// Admin wallet
address constant ADMIN = 0x0309dc91bB89750C317Ec69566bAF1613b57e6bB;

// Arbitrum Callback Proxy (Reactive Network official)
address constant ARB_CALLBACK_PROXY = 0x4730c58FDA9d78f60c987039aEaB7d261aAd942E;

// SushiSwap V2 Router on Arbitrum
address constant SUSHI_V2_ROUTER = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;

// SushiSwap V2 WETH/USDC.e pair on Arbitrum (higher liquidity than native USDC)
// WETH:   0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
// USDC.e: 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8
// Verified via: cast call 0xc35DADB65012eC5796536bD9864eD8773aBc74C4 \
//   "getPair(address,address)(address)" \
//   0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 \
//   0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8 \
//   --rpc-url $ARBITRUM_RPC
address constant WETH_USDC_PAIR = 0x905dfCD5649217c42684f23958568e533C711Aa3;

// Step 1: Deploy Callback on Arbitrum
contract DeployCallback is Script {
    function run() external {
        uint256 pk = vm.envUint("ARBITRUM_WALLET_PRIVATEKEY");
        vm.startBroadcast(pk);

        ArbitrumStopOrderCallback callback = new ArbitrumStopOrderCallback(
            ADMIN,
            ARB_CALLBACK_PROXY,
            SUSHI_V2_ROUTER
        );

        vm.stopBroadcast();

        console.log("=== ArbitrumStopOrderCallback deployed on Arbitrum ===");
        console.log("Address:", address(callback));
        console.log("Copy this address into CALLBACK_CONTRACT in .env");
    }
}

// Step 2: Deploy Reactive on Reactive Mainnet
contract DeployReactive is Script {
    function run() external {
        uint256 pk               = vm.envUint("ARBITRUM_WALLET_PRIVATEKEY");
        address callbackContract = vm.envAddress("CALLBACK_CONTRACT");

        vm.startBroadcast(pk);

        // Send 1 REACT to cover subscription fees
        ArbitrumStopOrderReactive reactive = new ArbitrumStopOrderReactive{value: 1 ether}(
            ADMIN,
            callbackContract,
            WETH_USDC_PAIR
        );

        vm.stopBroadcast();

        console.log("=== ArbitrumStopOrderReactive deployed on Reactive Mainnet ===");
        console.log("Address:", address(reactive));
    }
}
