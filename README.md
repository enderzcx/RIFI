# RIFI — Reactive Intelligence for Financial Instruments

> **AI decides. Reactive executes.**

AI-native autonomous trading agent on Base. Connect any wallet, enable Session Key, and let the AI trade for you — swap, stop-loss, take-profit, all on-chain. Reactive Smart Contracts execute your orders 24/7, even if the frontend goes offline.

**Live Demo:** [enderzcxai.duckdns.org](https://enderzcxai.duckdns.org)

---

## Problem

Traditional DEX stop-loss requires a centralized backend to monitor prices. Server down = orders don't execute.

**Reactive Smart Contracts fix this.** They subscribe to on-chain events and autonomously trigger callbacks — no backend, no keeper, no bot.

---

## How It Works

### Two Modes of Operation

```
┌─────────────────────────────────────────────────────┐
│              USER CONNECTS WALLET                    │
│                      │                               │
│         ┌────────────┴────────────┐                  │
│         ▼                         ▼                  │
│   No Session Key            Session Key Active       │
│   (Manual Mode)             (Auto Mode)              │
│         │                         │                  │
│   AI returns unsigned tx    AI executes directly     │
│   User signs in MetaMask    No signature needed      │
│         │                         │                  │
│         └────────────┬────────────┘                  │
│                      ▼                               │
│            On-chain execution                        │
│         Uniswap V2 / Reactive SL/TP                  │
└─────────────────────────────────────────────────────┘
```

### Sentinel Mode (Autonomous Trading)

```
Every 15 min — Intelligence Pipeline
         │
         ├── 27+ sources (FRED/VIX, GDELT, news, Twitter, on-chain)
         └── LLM: analyze → { action, confidence, push_worthy }
                    │
                    ├── Conservative: trade only on FLASH signals, confidence > 70
                    └── Aggressive: trade on PRIORITY+ signals, confidence > 50
                    │
                    ▼
         SessionManager.executeSwap() on-chain
         SSE push → Chat displays decision + TX hash
```

### Reactive Stop-Loss / Take-Profit

```
User: "Set stop-loss at $1800"
         │
         ├── Approve WETH to Callback (Base) — user pre-approved via Session setup
         └── Deploy Reactive contract (Reactive Network 1597) — server deploys, client = user
                    │
                    │ Monitors Uniswap WETH/USDC Sync events
                    │ Every swap: "Is price <= $1800?"
                    │
                    └── YES → StopOrderCallback.execute() on Base
                                   ├── Re-verify price (double check)
                                   ├── Swap WETH → USDC
                                   └── Send to user wallet
```

---

## Deployed Contracts

### Base Mainnet (8453)

| Contract | Address |
|----------|---------|
| StopOrderCallback | [`0x9702...f3`](https://basescan.org/address/0x9702220849b78318d7596B0F6503081DeE0a64f3) |
| OrderRegistry | [`0xcE97...98`](https://basescan.org/address/0xcE9720Ae1185e8E8c5739A5d3f88D75F3823D698) |
| SessionManager | [`0x5810...0e`](https://basescan.org/address/0x5810d1A3DAEfe21fB266aB00Ec74ca628637550e) |
| Callback Proxy | [`0x0D3E...47`](https://basescan.org/address/0x0D3E76De6bC44309083cAAFdB49A088B8a250947) |

### Reactive Mainnet (1597)

| Contract | Address |
|----------|---------|
| PairOrderManager | [`0x3421...11`](https://kopli.reactscan.net/address/0x342168e8D2BF8315BbF72F409A94f1EC7570f611) |

---

## Transaction Proof

### Real WETH/USDC Stop-Loss — Base Mainnet

| Step | Chain | TX |
|------|-------|----|
| Deploy Reactive | RNK (1597) | `0xbCee0509...` |
| **Stop-loss executed** | Base | [`0x600e7eaa...`](https://basescan.org/tx/0x600e7eaadc7034283067171ee3d41fdd55fe9ec2153ed1c2a9276f5098107661) |

Sold 0.001 WETH → 2.112 USDC, block 43860043

### End-to-End — Sepolia Testnet

| Step | Chain | TX |
|------|-------|----|
| Deploy Reactive | Lasna | [`0x5c9b6b60...`](https://kopli.reactscan.net/tx/0x5c9b6b60234b695548873111737e45b860d7f7d4cc9f21c89c67b17e41531b41) |
| Price trigger | Sepolia | [`0x6f11c03e...`](https://sepolia.etherscan.io/tx/0x6f11c03ecdf19ab6014b75e207caed611a0b87b35765f98ac9274881690a1830) |
| **Callback** | Sepolia | [`0x114096dc...`](https://sepolia.etherscan.io/tx/0x114096dcfb745aeda507383fc540d8d53ef42f6ba1152e665ded980fc3f2ad89) |

---

## Smart Contracts (`src/`)

| File | Purpose |
|------|---------|
| `StopOrderCallback.sol` | Callback executor: double price verification, configurable slippage, try-catch swap with token refund |
| `PairOrderManager.sol` | Reactive contract: subscribes to Uniswap Sync events, multi-order state, single-trigger protection |
| `OrderRegistry.sol` | On-chain order ledger, OCO (one-cancels-other) linked orders |
| `SessionVault.sol` | Session key: user grants AI limited trading rights (maxPerTrade, totalBudget, expiry) |

---

## Deployment

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup && forge install
```

**Step 1 — Base:** `forge script script/DeployBaseStopOrder.s.sol:DeployBase --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --broadcast -vvvv`

**Step 2 — Reactive:** `forge script script/DeployBaseStopOrder.s.sol:DeployReactive --rpc-url $REACTIVE_RPC --private-key $PRIVATE_KEY --broadcast -vvvv`

**Step 3 — Web:** `cd web && cp .env.example .env.local && npm install && npm run dev`

---

## Key Features

- **Multi-wallet**: Any wallet connects and trades with its own assets
- **Dual mode**: Session Key (AI auto-executes) or Manual (MetaMask signs each tx)
- **Sentinel Mode**: Conservative / Aggressive autonomous trading
- **Reactive SL/TP**: Decentralized, runs forever without backend
- **Session Key**: On-chain budget enforcement (per-trade limit, total cap, expiry)
- **Streaming UI**: Tool execution visible step-by-step in real-time
- **27+ data sources**: FRED, GDELT, crypto news, Twitter sentiment

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI-compatible LLM |
| Blockchain | Base (8453) + Reactive Network (1597) |
| Contracts | Solidity 0.8+, Foundry, OpenZeppelin |
| Real-time | Server-Sent Events (SSE) |
