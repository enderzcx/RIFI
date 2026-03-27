#!/bin/bash
# =============================================================================
# Arbitrum Stop-Loss / Take-Profit — Deployment Script
# =============================================================================
#
# Prerequisites:
#   1. Arbitrum wallet funded with ETH (for gas)
#   2. Reactive Network wallet funded with REACT tokens (for subscriptions)
#      - Same private key works on both chains
#      - Get REACT from https://rnk.dev or bridge
#   3. .env configured with ARBITRUM_WALLET_PRIVATEKEY, ARBITRUM_RPC, REACTIVE_RPC
#
# Usage:
#   Step 1: ./deploy.sh callback    (deploys Callback on Arbitrum)
#   Step 2: Set CALLBACK_CONTRACT in .env with the printed address
#   Step 3: ./deploy.sh reactive    (deploys Reactive on Reactive Network)
#
# After deployment:
#   - Users call createStopOrder() on the Callback contract (Arbitrum)
#   - Reactive contract auto-monitors Sync events and triggers execution
#   - Each order is independently tracked and triggered
# =============================================================================

set -e
source .env

case "$1" in
  callback)
    echo "=== Step 1: Deploying ArbitrumStopOrderCallback on Arbitrum ==="
    forge script script/DeployArbitrumStopOrder.s.sol:DeployCallback \
      --rpc-url "$ARBITRUM_RPC" \
      --private-key "$ARBITRUM_WALLET_PRIVATEKEY" \
      --broadcast -vvvv
    echo ""
    echo ">>> Copy the deployed address above and set CALLBACK_CONTRACT in .env"
    ;;

  reactive)
    if [ -z "$CALLBACK_CONTRACT" ]; then
      echo "ERROR: CALLBACK_CONTRACT not set in .env. Deploy callback first."
      exit 1
    fi
    echo "=== Step 2: Deploying ArbitrumStopOrderReactive on Reactive Mainnet ==="
    forge script script/DeployArbitrumStopOrder.s.sol:DeployReactive \
      --rpc-url "$REACTIVE_RPC" \
      --private-key "$ARBITRUM_WALLET_PRIVATEKEY" \
      --broadcast -vvvv
    ;;

  *)
    echo "Usage: ./deploy.sh [callback|reactive]"
    echo "  callback  — Deploy ArbitrumStopOrderCallback on Arbitrum (Step 1)"
    echo "  reactive  — Deploy ArbitrumStopOrderReactive on Reactive Network (Step 2)"
    exit 1
    ;;
esac
