// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/SessionManagerV2.sol";

// Deploy SessionManagerV2 on Base:
//   forge script script/DeploySessionManagerV2.s.sol:DeploySessionManagerV2 \
//     --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
//     --broadcast -vvvv

contract DeploySessionManagerV2 is Script {
    // Uniswap V2 Router on Base
    address constant UNISWAP_ROUTER = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;

    function run() external {
        vm.startBroadcast();

        SessionManagerV2 sm = new SessionManagerV2(UNISWAP_ROUTER);

        console.log("SessionManagerV2 deployed at:", address(sm));
        console.log("Owner:", sm.owner());
        console.log("Router:", address(sm.router()));

        vm.stopBroadcast();
    }
}
