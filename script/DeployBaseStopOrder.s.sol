// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/StopOrderCallback.sol";
import "../src/OrderRegistry.sol";
import "../src/PairOrderManager.sol";
import "../src/SessionVault.sol";

// ============================================================================
// Three-step deployment for Base chain:
//
//   Step 1 — Deploy OrderRegistry + StopOrderCallback on Base (8453):
//     forge script script/DeployBaseStopOrder.s.sol:DeployBase \
//       --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
//       --broadcast -vvvv
//
//     → Copy printed addresses → set in .env
//
//   Step 2 — Deploy PairOrderManager on Reactive Mainnet (1597):
//     forge script script/DeployBaseStopOrder.s.sol:DeployReactive \
//       --rpc-url $REACTIVE_RPC --private-key $PRIVATE_KEY \
//       --broadcast -vvvv
//
//   Step 3 (optional) — Deploy SessionVault on Base:
//     forge script script/DeployBaseStopOrder.s.sol:DeploySession \
//       --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
//       --broadcast -vvvv
// ============================================================================

// Base Callback Proxy (Reactive Network official on Base)
address constant BASE_CALLBACK_PROXY = 0x0D3E76De6bC44309083cAAFdB49A088B8a250947;

// Uniswap V2 Router on Base
address constant BASE_UNISWAP_ROUTER = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;

// WETH/USDC pair on Base
address constant BASE_WETH_USDC_PAIR = 0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C;

// Step 1: Deploy OrderRegistry + StopOrderCallback on Base
contract DeployBase is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // 1a. Deploy OrderRegistry
        OrderRegistry registry = new OrderRegistry(deployer, address(0));
        console.log("=== OrderRegistry deployed on Base ===");
        console.log("Address:", address(registry));

        // 1b. Deploy StopOrderCallback (100 bps = 1% default slippage)
        StopOrderCallback callback = new StopOrderCallback(
            BASE_CALLBACK_PROXY,
            BASE_UNISWAP_ROUTER,
            address(registry),
            100 // 1% slippage
        );
        console.log("=== StopOrderCallback deployed on Base ===");
        console.log("Address:", address(callback));

        // 1c. Link callback in registry
        registry.setCallbackAddr(address(callback));
        console.log("Registry callback set to:", address(callback));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Next steps ===");
        console.log("1. Set CALLBACK_CONTRACT=", address(callback), " in .env");
        console.log("2. Set ORDER_REGISTRY=", address(registry), " in .env");
        console.log("3. Run DeployReactive on Reactive Mainnet");
    }
}

// Step 2: Deploy PairOrderManager on Reactive Mainnet
contract DeployReactive is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address callbackContract = vm.envAddress("CALLBACK_CONTRACT");
        address registryAddr = vm.envAddress("ORDER_REGISTRY");

        // Deployer is also the backend for order management
        address backend = vm.addr(pk);

        vm.startBroadcast(pk);

        // Deploy with empty initial orders (orders added dynamically via events)
        uint256[] memory orderIds = new uint256[](0);
        address[] memory clients = new address[](0);
        bool[] memory isStopLoss = new bool[](0);
        bool[] memory sellToken0 = new bool[](0);
        uint256[] memory coefficients = new uint256[](0);
        uint256[] memory thresholds = new uint256[](0);
        uint256[] memory amounts = new uint256[](0);

        // Send 0.1 REACT to cover subscription fees
        PairOrderManager reactive = new PairOrderManager{value: 0.1 ether}(
            BASE_WETH_USDC_PAIR,
            registryAddr,
            callbackContract,
            backend,
            orderIds,
            clients,
            isStopLoss,
            sellToken0,
            coefficients,
            thresholds,
            amounts
        );

        vm.stopBroadcast();

        console.log("=== PairOrderManager deployed on Reactive Mainnet ===");
        console.log("Address:", address(reactive));
        console.log("Monitoring pair:", BASE_WETH_USDC_PAIR);
        console.log("Callback target:", callbackContract);
    }
}

// Step 3 (optional): Deploy SessionVault on Base
contract DeploySession is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        SessionVault vault = new SessionVault();

        vm.stopBroadcast();

        console.log("=== SessionVault deployed on Base ===");
        console.log("Address:", address(vault));
    }
}
