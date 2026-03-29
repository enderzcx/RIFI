# RIFI — Reactive Intelligence for Financial Instruments

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Base](https://img.shields.io/badge/Chain-Base-0052FF)](https://base.org)
[![Reactive](https://img.shields.io/badge/Reactive_Network-1597-purple)](https://reactive.network)
[![Demo](https://img.shields.io/badge/Live_Demo-online-green)](https://enderzcxai.duckdns.org)

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
         ├── Crucix (27+ OSINT sources)
         ├── OpenNews / 6551.io (AI-scored crypto news)
         ├── OnchainOS (on-chain analytics)
         └── LLM: analyze → { action, confidence, push_worthy }
                    │
                    ├── Conservative: FLASH signals only, confidence > 70
                    └── Aggressive: PRIORITY+ signals, confidence > 50
                    │
                    ▼
         SessionManager.executeSwap() on-chain
         SSE push → Chat displays decision + TX hash
```

### Reactive Stop-Loss / Take-Profit

```
User: "Set stop-loss at $1800"
         │
         ├── Approve WETH to Callback (Base)
         └── AI deploys Reactive contract (RNK 1597, client = user)
                    │
                    │ Monitors Uniswap WETH/USDC Sync events forever
                    │ Every swap: "Is price <= $1800?"
                    │
                    └── YES → StopOrderCallback.execute() on Base
                                   ├── Re-verify price (double check)
                                   ├── Swap WETH → USDC
                                   └── Send to user wallet
```

---

## Intelligence Sources

RIFI aggregates multiple real-time data sources to power AI trading decisions:

| Source | Repository / Link | Data | Required |
|--------|-------------------|------|----------|
| **Crucix** | [github.com/enderzcx/Crucix](https://github.com/enderzcx/Crucix) | 27+ OSINT sources: FRED (VIX/CPI/yields), GDELT/ACLED (geopolitics), energy (WTI/gas), Reddit, Telegram, satellite, weather | Optional — AI uses fallback signals without it |
| **OpenNews** | [6551.io](https://ai.6551.io) | AI-scored crypto news with sentiment (0-100) and directional signal (long/short/neutral) | Optional — requires API token |
| **OnchainOS** | [OKX OnchainOS](https://www.okx.com/web3/discover/cryptopedia/onchain-os) | On-chain analytics: whale movements, holder distribution, smart money flows | Optional — basic data from Crucix fallback |
| **Uniswap V2** | On-chain (Base) | Real-time WETH/USDC price from pool reserves | Built-in — no config needed |
| **Reactive Network** | [reactive.network](https://reactive.network) | Cross-chain event monitoring for decentralized order execution | Built-in — contracts pre-deployed |

---

## AI Tools (14 total)

| Tool | Source | Purpose |
|------|--------|---------|
| `get_market_signals` | Crucix + OpenNews → LLM | 27-source AI-analyzed market summary |
| `get_crypto_news` | OpenNews / 6551.io | Raw AI-scored crypto news with clickable links |
| `get_crucix_data` | Crucix OSINT Engine | Raw macro data: VIX, BTC, oil, conflicts, TG alerts |
| `get_onchain_data` | OnchainOS | On-chain analytics: whales, holders, smart money |
| `get_price` | Uniswap V2 (Base) | Real-time WETH/USDC price + pool reserves |
| `get_portfolio` | Base RPC | User wallet balances (WETH, USDC, ETH) |
| `market_swap` | Uniswap V2 | Execute swap (auto or manual signing) |
| `session_swap` | SessionManager | Autonomous swap within budget |
| `set_stop_loss` | Reactive Network | Deploy decentralized stop-loss contract |
| `set_take_profit` | Reactive Network | Deploy decentralized take-profit contract |
| `get_active_orders` | OrderRegistry | List active SL/TP orders |
| `cancel_order` | OrderRegistry | Cancel specific order |
| `get_session` | SessionManager | Check session budget and status |
| `update_memory` | Local storage | Persist user preferences and trading patterns |

---

## Quick Start

### Prerequisites

- Node.js 18+
- An OpenAI-compatible LLM API endpoint (OpenAI, local Ollama, etc.)
- A wallet with ETH on Base (for gas)
- [Foundry](https://book.getfoundry.sh/) (for contract deployment only)

### 1. Clone & Install

```bash
git clone https://github.com/enderzcx/RIFI.git
cd RIFI/web
cp .env.example .env.local
npm install
```

### 2. Configure `.env.local`

```env
# Required
LLM_ENDPOINT=http://your-llm:8080/v1    # Any OpenAI-compatible API
LLM_API_KEY=your-key
PRIVATE_KEY=0x_your_wallet_key           # Backend executor wallet

# Optional — for full intelligence pipeline
VPS_API_URL=http://your-vps:3200         # If running VPS intelligence
```

Contract addresses are pre-filled — you can reuse the deployed contracts on Base.

### 3. Run

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000) → Connect wallet → Start chatting.

### 4. (Optional) Run Intelligence Pipeline

For full Sentinel Mode with 27+ data sources:

```bash
# Terminal 1: Start Crucix (see github.com/enderzcx/Crucix)
cd /path/to/Crucix && node server.mjs

# Terminal 2: Start VPS API
cd RIFI
cp vps-api/.env.example vps-api/.env
# Edit vps-api/.env with your API keys
node vps-api-index.mjs
```

### 5. (Optional) Deploy Your Own Contracts

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge install

# Deploy on Base
forge script script/DeployBaseStopOrder.s.sol:DeployBase \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --broadcast -vvvv

# Deploy on Reactive Network
forge script script/DeployBaseStopOrder.s.sol:DeployReactive \
  --rpc-url $REACTIVE_RPC --private-key $PRIVATE_KEY --broadcast -vvvv
```

---

## What Works Without the VPS

| Feature | Without VPS | With VPS |
|---------|-------------|----------|
| Chat with AI | ✅ | ✅ |
| Check price | ✅ | ✅ |
| View portfolio | ✅ | ✅ |
| Market swap | ✅ | ✅ |
| Stop-loss / Take-profit | ✅ | ✅ |
| Session Key auto-trading | ✅ | ✅ |
| Market intelligence signals | ⚠️ Fallback defaults | ✅ Real-time 27-source |
| Crypto news | ❌ | ✅ |
| Crucix macro data | ❌ | ✅ |
| Sentinel Mode auto-trade | ❌ | ✅ |

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
| `StopOrderCallback.sol` | Callback: double price verify, configurable slippage, try-catch swap with token refund |
| `PairOrderManager.sol` | Reactive: subscribes to Uniswap Sync events, multi-order state, single-trigger protection |
| `OrderRegistry.sol` | Order ledger, OCO (one-cancels-other) linked orders |
| `SessionVault.sol` | Session key budget enforcement (maxPerTrade, totalBudget, expiry) |

---

## Key Features

- **Multi-wallet**: Any wallet connects and trades with its own assets
- **Dual mode**: Session Key (AI auto-executes) or Manual (MetaMask signs each tx)
- **Sentinel Mode**: Conservative / Aggressive autonomous trading
- **Reactive SL/TP**: Decentralized, runs forever without backend
- **Session Key**: On-chain budget enforcement (per-trade limit, total cap, expiry)
- **Streaming UI**: Tool execution visible step-by-step in real-time
- **14 AI tools**: Independent access to news, macro data, on-chain analytics, trading, and memory
- **AI Memory**: Learns user preferences, risk tolerance, and trading patterns across sessions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI-compatible LLM |
| Blockchain | Base (8453) + Reactive Network (1597) |
| Contracts | Solidity 0.8+, Foundry, OpenZeppelin |
| Real-time | Server-Sent Events (SSE) |
| Intelligence | [Crucix](https://github.com/enderzcx/Crucix), [OpenNews](https://ai.6551.io), OnchainOS |

---

## License

MIT — see [LICENSE](LICENSE)
