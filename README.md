# RIFI — Reactive Intelligence for Financial Instruments

> **AI decides. Reactive executes.**

AI-native autonomous trading agent on Base, powered by Reactive Smart Contracts for decentralized stop-loss / take-profit execution. Features **Sentinel Mode** — a 24/7 autonomous trading agent that monitors 27+ data sources, makes decisions, and executes on-chain. Even if the frontend goes offline, deployed stop-loss orders keep running on Reactive Network.

---

## Problem Statement

**Traditional stop-loss and take-profit orders on DEXs require a centralized backend to monitor prices and submit transactions.** If the server goes down, orders don't execute — your position is unprotected. This creates a single point of failure that contradicts the entire premise of decentralized finance.

Existing solutions either:
- Rely on centralized keeper networks (Gelato, Chainlink Automation) with their own trust assumptions
- Require users to run their own bots 24/7
- Only work within a single chain's execution environment

**Why Reactive Network solves this:**

Reactive Smart Contracts subscribe to on-chain events (Uniswap V2 Sync) across chains and **autonomously trigger callback transactions** when conditions are met — no backend, no keeper, no bot. The stop-loss logic lives entirely on-chain across two networks:

1. **Base (Origin):** Where the user's tokens and Uniswap liquidity live
2. **Reactive Network (Monitor):** Where the price-watching contract listens to Base events and triggers callbacks

Once deployed, the Reactive contract runs forever without any centralized infrastructure. Even if RIFI's frontend and VPS are completely offline, deployed stop-loss orders will still execute.

---

## How It Works

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   USER (Browser)                          │
│   Chat with AI  ←→  Next.js  ←→  LLM (GPT-5.4)         │
│                        │                                  │
│   AI decides: "Buy 0.1 ETH, set SL at $2000"            │
└────────────────────────┼─────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌───────────┐ ┌──────────────┐
   │ Market Swap│ │ Approve   │ │ Deploy       │
   │ Uniswap V2│ │ WETH to   │ │ Reactive     │
   │ on Base    │ │ Callback  │ │ Contract     │
   └────────────┘ └───────────┘ └──────┬───────┘
                                       │
                                       ▼
                         ┌──────────────────────┐
                         │  REACTIVE NETWORK     │
                         │  PairOrderManager     │
                         │                       │
                         │  Subscribes to Base   │
                         │  Uniswap Sync events  │
                         │                       │
                         │  Every swap on Base:   │
                         │  "Is price <= $2000?"  │
                         └───────────┬───────────┘
                                     │ YES
                                     ▼
                         ┌──────────────────────┐
                         │  BASE CHAIN           │
                         │  StopOrderCallback    │
                         │                       │
                         │  1. Verify price again │
                         │  2. transferFrom WETH  │
                         │  3. Swap WETH → USDC   │
                         │  4. Send USDC to user  │
                         └──────────────────────┘
```

### Step-by-Step Runtime Flow

1. **User creates stop-loss via AI chat:** "Set stop-loss for 0.1 WETH at $2000"
2. **AI calls `set_stop_loss(0.1, 2000)`** which:
   - Approves 0.1 WETH to `StopOrderCallback` on Base
   - Creates order in `OrderRegistry` on Base (emits `OrderCreated` event)
   - `PairOrderManager` on Reactive Network picks up the event and starts monitoring
3. **Monitoring (fully decentralized):**
   - Every Uniswap V2 swap on the WETH/USDC pair emits a `Sync(reserve0, reserve1)` event on Base
   - `PairOrderManager` on Reactive Network receives every Sync event
   - Calculates price: `reserve1 * 1e12 / reserve0`
   - Checks: `price <= 2000?`
4. **Trigger (when price condition met):**
   - `PairOrderManager` marks order as `triggered` (prevents double-execution)
   - Emits `Callback` to `StopOrderCallback` on Base with 1M gas
5. **Execution on Base:**
   - `StopOrderCallback.execute()` re-checks price on-chain (double verification)
   - Checks user balance and allowance (graceful fail if insufficient)
   - Swaps WETH → USDC via Uniswap V2 Router with configurable slippage
   - If swap fails: returns tokens to user (try-catch, no funds lost)
   - Calls `OrderRegistry.markExecutedAndCancelLinked()` (cancels paired TP order if OCO)
6. **Frontend notification:** EventIndexer detects `Executed` event → SSE push → Chat displays result

---

## Deployed Contracts

### Base Mainnet (Chain ID: 8453)

| Contract | Address | Purpose |
|----------|---------|---------|
| **StopOrderCallback** | [`0x9702220849b78318d7596B0F6503081DeE0a64f3`](https://basescan.org/address/0x9702220849b78318d7596B0F6503081DeE0a64f3) | Executes swaps when triggered by Reactive |
| **OrderRegistry** | [`0xcE9720Ae1185e8E8c5739A5d3f88D75F3823D698`](https://basescan.org/address/0xcE9720Ae1185e8E8c5739A5d3f88D75F3823D698) | On-chain order ledger with OCO support |
| **SessionVault** | [`0xEF1581bfDfC71b079247Df9b5e6127D686fd0682`](https://basescan.org/address/0xEF1581bfDfC71b079247Df9b5e6127D686fd0682) | Session key budget enforcement for AI autonomous trading |
| Callback Proxy | [`0x0D3E76De6bC44309083cAAFdB49A088B8a250947`](https://basescan.org/address/0x0D3E76De6bC44309083cAAFdB49A088B8a250947) | Reactive Network official proxy on Base |
| WETH | `0x4200000000000000000000000000000000000006` | Wrapped ETH on Base |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | USD Coin on Base |
| Uniswap V2 Router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | DEX routing |
| WETH/USDC Pair | `0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C` | Price monitoring target |

### Reactive Mainnet (Chain ID: 1597)

| Contract | Address | Purpose |
|----------|---------|---------|
| **PairOrderManager** | [`0x342168e8D2BF8315BbF72F409A94f1EC7570f611`](https://kopli.reactscan.net/address/0x342168e8D2BF8315BbF72F409A94f1EC7570f611) | Monitors Base Sync events, triggers callbacks |
| Reactive Contract (simple test) | `0xC28Ea685209c8A10Cc4808c9694A3ae6c22c4eAE` | Simple single-order test deployment |
| Reactive Contract (real pair) | `0xbCee0509254E6bcF6F6922Ba425c59acb14b27E0` | WETH/USDC real pair monitoring |

---

## Transaction Proof

### Test 1: Synthetic Pair (BTKA/BTKB) on Base

Full reactive loop with test tokens to verify the complete flow.

| Step | Chain | Transaction | Description |
|------|-------|-------------|-------------|
| Deploy Callback | Base | [`0xc93a7d55...`](https://basescan.org/tx/0xc93a7d55128e3308c9a084962e26f400af802a49b91a939115555ed59c18fdc1) | StopOrderCallback deployed |
| Deploy Reactive | RNK (1597) | [`0x2190830c...`](https://kopli.reactscan.net/tx/0x2190830c0f2c1f10c1ee87c2e2bfc3f831c76d1138fdba2f3c843f202b06b78a) | Reactive contract deployed, subscribed to Sync events |
| **Callback Executed** | Base | [`0xfd891eb2...`](https://basescan.org/tx/0xfd891eb2ea12d156af3868dbcea3846d76b085766675fb511ef2567dfc977616) | **Stop-loss triggered!** Sold 1 BTKA → 0.912 BTKB |

- **Trigger latency:** ~8 seconds (4 blocks from Sync to Callback execution)
- **Block:** 43859462

### Test 2: Real WETH/USDC Pair on Base

Production test with real WETH/USDC on Base mainnet.

| Step | Chain | Transaction | Description |
|------|-------|-------------|-------------|
| Deploy Reactive | RNK (1597) | (deployed to `0xbCee0509...`) | Subscribed to WETH/USDC Sync events |
| **Callback Executed** | Base | [`0x600e7eaa...`](https://basescan.org/tx/0x600e7eaadc7034283067171ee3d41fdd55fe9ec2153ed1c2a9276f5098107661) | **Stop-loss triggered!** Sold 0.001 WETH → 2.112007 USDC |

- **Block:** 43860043
- **Gas used:** 231,695
- **Events emitted:** Transfer, Approval, Sync, Swap, Stop, CallbackExecuted (9 total)

### Test 3: Sepolia Testnet (End-to-End)

| Step | Chain | Transaction | Description |
|------|-------|-------------|-------------|
| Deploy Callback | Sepolia | [`0x63f46741...`](https://sepolia.etherscan.io/tx/0x63f46741fdcdc2390b5c0d649c35167b911e0b939844c6628a95298f972bae0b) | Callback deployed |
| Deploy Reactive | Lasna (5318007) | [`0x5c9b6b60...`](https://kopli.reactscan.net/tx/0x5c9b6b60234b695548873111737e45b860d7f7d4cc9f21c89c67b17e41531b41) | Reactive contract deployed |
| Trigger Swap | Sepolia | [`0x6f11c03e...`](https://sepolia.etherscan.io/tx/0x6f11c03ecdf19ab6014b75e207caed611a0b87b35765f98ac9274881690a1830) | Price dropped below threshold |
| **Callback Executed** | Sepolia | [`0x114096dc...`](https://sepolia.etherscan.io/tx/0x114096dcfb745aeda507383fc540d8d53ef42f6ba1152e665ded980fc3f2ad89) | **Stop-loss triggered!** Sold 1 TKA → 0.905 TKB |

- **Trigger latency:** ~3 minutes (Lasna testnet)

---

## Smart Contract Overview

### Source Files (`src/`)

| File | Lines | Purpose |
|------|-------|---------|
| `StopOrderCallback.sol` | 182 | Base callback: double price verification, balance check, configurable slippage, try-catch swap with token refund on failure |
| `PairOrderManager.sol` | 229 | Reactive contract: subscribes to Uniswap Sync events on Base, manages multi-order state, triggers callbacks |
| `OrderRegistry.sol` | 141 | On-chain order ledger with OCO (one-cancels-other) linked orders |
| `SessionVault.sol` | 107 | Session key system: user grants AI limited trading rights (maxPerTrade, totalBudget, expiry) |
| `ArbitrumStopOrderCallback.sol` | ~400 | Arbitrum variant with retry logic (5 retries, 30s cooldown) |
| `ArbitrumStopOrderReactive.sol` | ~350 | Arbitrum variant with trigger cooldown (10 attempts, 60s cooldown) |

### Key Design Decisions

1. **Double price verification:** Reactive triggers based on Sync event, but Callback re-reads `getReserves()` on Base before executing. Guards against Reactive→Base propagation delay.

2. **Graceful failure:** If balance/allowance is insufficient at execution time, `emit ExecutionFailed()` + `return` instead of reverting. No gas wasted, no funds stuck.

3. **Try-catch swap:** If Uniswap swap reverts (slippage, liquidity), tokens are returned to user via `safeTransfer`. Order remains triggerable for retry.

4. **OCO (One-Cancels-Other):** `OrderRegistry.linkedOrderId` — when stop-loss executes, linked take-profit is automatically cancelled (and vice versa).

5. **Configurable slippage:** `slippageBps` (basis points, 0-1000). Default 1% (100 bps). Adjustable by owner via `setSlippage()`.

6. **Single-trigger protection:** `PairOrderManager` sets `triggered = true` on first match, preventing duplicate execution during flash crashes.

---

## Deployment

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Clone and install dependencies
git clone <repo-url> && cd RIFI
forge install
```

### Step 1: Deploy on Base

```bash
# Set environment variables
export BASE_RPC_URL=https://mainnet.base.org
export PRIVATE_KEY=0x_your_private_key

# Deploy OrderRegistry + StopOrderCallback
forge script script/DeployBaseStopOrder.s.sol:DeployBase \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
  --broadcast -vvvv
```

Copy the printed addresses into `.env`:
```
CALLBACK_CONTRACT=0x...
ORDER_REGISTRY=0x...
```

### Step 2: Deploy on Reactive Mainnet

```bash
export REACTIVE_RPC=https://mainnet-rpc.rnk.dev/

# Deploy PairOrderManager (needs REACT tokens for subscription)
forge script script/DeployBaseStopOrder.s.sol:DeployReactive \
  --rpc-url $REACTIVE_RPC --private-key $PRIVATE_KEY \
  --broadcast -vvvv
```

### Step 3 (Optional): Deploy SessionVault

```bash
forge script script/DeployBaseStopOrder.s.sol:DeploySession \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
  --broadcast -vvvv
```

### Step 4: Start Web Application

```bash
cd web
cp .env.example .env.local
# Edit .env.local with your contract addresses and API keys
npm install
npm run dev
```

---

## Sentinel Mode — AI Trading Agent

RIFI is more than smart contracts — it's an **AI-native trading system** where the Sentinel agent:

- **Aggregates 27+ data sources** every 15 minutes (FRED/VIX, GDELT geopolitics, crypto news, Twitter sentiment, on-chain data)
- **Makes autonomous trading decisions** with confidence scoring
- **Executes via Reactive contracts** — stop-loss and take-profit orders are fully decentralized
- **Operates within user-defined budgets** — SessionVault enforces per-trade limits, total budget caps, and time-based expiry
- **Maintains persistent memory** — learns user's risk tolerance, trading patterns, and token preferences

### VPS Intelligence Pipeline (`vps-api-index.mjs`)

```
Every 15 minutes:
  1. Fetch 27+ data sources (macro, crypto, geopolitics, sentiment)
  2. Small model (Qwen 0.8b) filters and compresses to structured signals
  3. Large model (GPT-5.4) analyzes and decides
  4. If push_worthy: trigger autonomous trade via SessionVault

Every 3 hours:
  5. Generate patrol report summarizing all decisions
  6. Push to frontend for user review
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi 3.6, Viem, ConnectKit |
| AI | OpenAI SDK → GPT-5.4, Qwen 3.5 0.8b (edge filtering) |
| Blockchain | Base (8453), Reactive Network (1597) |
| Smart Contracts | Solidity 0.8+, Foundry, OpenZeppelin |
| Real-time | Server-Sent Events (SSE) |
| Intelligence | 27+ OSINT sources via Crucix engine |

---

## Edge Case Handling

See [EDGE-CASE-AUDIT.md](./EDGE-CASE-AUDIT.md) for full analysis. Key points:

- **Price = threshold:** Uses `<=` / `>=` — exact match triggers execution
- **Flash crash:** `triggered` flag prevents multiple executions per order
- **OCO race condition:** `OrderRegistry.linkedOrderId` ensures only one side executes
- **Reactive→Base delay:** Double price verification at callback execution time
- **Insufficient balance at execution:** Graceful `ExecutionFailed` event, no revert
- **Swap failure (slippage/liquidity):** Try-catch returns tokens to user
- **Chain reorg:** OrderRegistry provides idempotent execution protection

---

## Repository Structure

```
RIFI/
├── src/                          # Smart Contracts (Solidity)
│   ├── StopOrderCallback.sol     # Base callback executor
│   ├── PairOrderManager.sol      # Reactive event monitor
│   ├── OrderRegistry.sol         # On-chain order ledger + OCO
│   ├── SessionVault.sol          # AI session key budget
│   └── Arbitrum*.sol             # Arbitrum variants
├── script/
│   ├── DeployBaseStopOrder.s.sol     # Base + Reactive deployment
│   └── DeployArbitrumStopOrder.s.sol # Arbitrum deployment
├── web/                          # Next.js application
│   ├── src/app/                  # Pages (chat, dashboard)
│   ├── src/lib/chain/            # On-chain interaction
│   ├── src/lib/llm/              # AI agent (tools, executor)
│   ├── src/lib/sse/              # Real-time push
│   └── src/lib/memory/           # Per-wallet persistent memory
├── vps-api-index.mjs             # VPS intelligence pipeline
├── ARCHITECTURE.md               # System architecture (Chinese)
├── ARCHITECTURE-FULL.md          # Detailed architecture (English)
├── EDGE-CASE-AUDIT.md            # Edge case analysis
└── foundry.toml                  # Forge configuration
```

---

## License

UNLICENSED (Hackathon project)
