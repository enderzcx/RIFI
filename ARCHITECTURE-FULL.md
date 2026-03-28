# RIFI Full Architecture

> AI-Native Trading Agent on Base — Complete System Architecture

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                           │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐                │
│  │ Sidebar  │  │  ChatWindow  │  │ RightPanel│                │
│  │ (Nav)    │  │  (AI Chat)   │  │ (Orders)  │                │
│  └──────────┘  └──────┬───────┘  └─────┬─────┘                │
│                       │ POST /api/chat  │ SSE /api/events      │
└───────────────────────┼─────────────────┼──────────────────────┘
                        │                 │
┌───────────────────────▼─────────────────▼──────────────────────┐
│                   NEXT.JS SERVER (web/)                         │
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐             │
│  │ /api/chat  │  │/api/signals│  │/api/auto-trade│             │
│  │ LLM Loop   │  │ VPS Proxy  │  │ Event→AI→Tx  │             │
│  └─────┬──────┘  └────────────┘  └──────┬───────┘             │
│        │                                 │                      │
│  ┌─────▼──────────────────────────────────▼─────┐              │
│  │              LLM ENGINE (lib/llm/)           │              │
│  │  system-prompt.ts → tools.ts → executor.ts   │              │
│  │  Model: GPT-5.4 (OpenAI-compatible API)      │              │
│  └─────┬────────────────────────────────────────┘              │
│        │ Tool Calls                                             │
│  ┌─────▼──────────────────────────────────────────┐            │
│  │            CHAIN LAYER (lib/chain/)             │            │
│  │  price.ts │ swap.ts │ stop-order.ts │ session.ts│            │
│  └─────┬──────────────────────────────────────────┘            │
│        │                                                        │
│  ┌─────▼──────────┐  ┌───────────────┐  ┌──────────────┐      │
│  │ EventIndexer   │  │  PushService  │  │   Memory     │      │
│  │ (Poll orders)  │  │  (SSE bcast)  │  │ (per-wallet) │      │
│  └────────────────┘  └───────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
         │                                         ▲
         ▼                                         │
┌────────────────────┐                ┌────────────┴─────────────┐
│   BASE CHAIN (L2)  │                │   VPS INTELLIGENCE       │
│                    │                │   (vps-api-index.mjs)    │
│  WETH, USDC        │                │                          │
│  Uniswap V2 Router │                │  15min: fetch→LLM→signal │
│  StopOrderCallback │                │  3h: patrol report        │
│  SessionManager    │                │  Event: push_worthy→auto  │
│  OrderRegistry     │                │                          │
└────────┬───────────┘                │  Sources: FRED, GDELT,   │
         │ Reactive Events            │  OKX, Twitter, News (27+)│
┌────────▼───────────┐                └──────────────────────────┘
│ REACTIVE NETWORK   │
│ (Chain 1597)       │
│                    │
│ PairOrderManager   │
│ (Monitor Sync →    │
│  Trigger Callback) │
└────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi 3.6, Viem, ConnectKit |
| LLM | OpenAI SDK → GPT-5.4 (OpenAI-compatible) |
| Blockchain | Base (8453), Reactive Network (1597) |
| Smart Contracts | Solidity 0.8+, Foundry |
| VPS Pipeline | Node.js, Express |
| Real-time | Server-Sent Events (SSE) |
| Storage | Filesystem (per-wallet memory), In-memory (orders) |

---

## Directory Structure

```
RIFI/
├── web/                          # Next.js app (frontend + API)
│   ├── src/app/
│   │   ├── layout.tsx            # Root layout + Web3Provider
│   │   ├── page.tsx              # → /chat redirect
│   │   ├── chat/page.tsx         # AI chat interface
│   │   ├── dashboard/page.tsx    # Portfolio + signals
│   │   └── api/
│   │       ├── chat/route.ts     # LLM reasoning loop (5 rounds)
│   │       ├── signals/route.ts  # Proxy VPS signals
│   │       ├── auto-trade/       # VPS→AI autonomous trade
│   │       ├── patrol-report/    # 3h patrol summary
│   │       ├── events/route.ts   # SSE stream
│   │       ├── portfolio/        # Balance snapshot
│   │       └── orders/           # Order history
│   │
│   ├── src/components/
│   │   ├── chat/ChatWindow.tsx   # Message UI + SSE events
│   │   ├── chat/ToolCallCard.tsx # Tool execution display
│   │   ├── layout/Sidebar.tsx    # Navigation
│   │   ├── layout/RightPanel.tsx # Active orders panel
│   │   ├── notifications/        # Auto-trade toasts
│   │   └── providers/            # Wagmi + ConnectKit
│   │
│   └── src/lib/
│       ├── types.ts              # Core interfaces
│       ├── llm/
│       │   ├── system-prompt.ts  # AI persona + rules (830 lines)
│       │   ├── tools.ts          # Tool definitions (OpenAI format)
│       │   ├── client.ts         # LLM client init
│       │   └── executor.ts       # Tool call → chain/memory routing
│       ├── chain/
│       │   ├── config.ts         # Contracts, ABIs, clients
│       │   ├── price.ts          # WETH/USDC from Uniswap pair
│       │   ├── portfolio.ts      # Balance reads
│       │   ├── swap.ts           # Uniswap V2 swap
│       │   ├── stop-order.ts     # Deploy Reactive SL/TP
│       │   ├── session.ts        # SessionManager budget
│       │   └── event-indexer.ts  # Poll orders + SSE broadcast
│       ├── sse/
│       │   ├── push-service.ts   # SSE singleton broadcaster
│       │   └── signal-hub.ts     # VPS poll → classify → push
│       └── memory/
│           └── index.ts          # Per-wallet file storage
│
├── src/                          # Smart Contracts (Solidity)
│   ├── SessionVault.sol          # Session key budget enforcement
│   ├── OrderRegistry.sol         # On-chain order ledger
│   ├── StopOrderCallback.sol     # Base callback executor
│   ├── PairOrderManager.sol      # Reactive order monitor
│   └── Arbitrum*.sol             # Arbitrum variants
│
├── script/                       # Forge deployment scripts
├── lib/                          # Solidity deps (OZ, Uniswap, forge-std)
├── vps-api-index.mjs             # VPS intelligence pipeline (480 lines)
└── foundry.toml                  # Forge config
```

---

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| StopOrderCallback | `0x9702220849b78318d7596B0F6503081DeE0a64f3` |
| CallbackProxy | `0x0D3E76De6bC44309083cAAFdB49A088B8a250947` |
| SessionManager | `0x5810d1A3DAEfe21fB266aB00Ec74ca628637550e` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Uniswap V2 Router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| WETH/USDC Pair | `0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C` |

---

## LLM Tool Set

### Market Intelligence
- `get_market_signals()` — VPS aggregated signals (macro risk, sentiment, alerts)
- `get_price()` — WETH/USDC spot from Uniswap pair reserves
- `get_portfolio()` — WETH, USDC, ETH balances

### Trading Execution
- `market_swap(direction, amount)` — Immediate Uniswap V2 swap
- `set_stop_loss(amount, price)` — Deploy Reactive contract (sells if price ≤)
- `set_take_profit(amount, price)` — Deploy Reactive contract (sells if price ≥)
- `session_swap(direction, amount)` — AI autonomous trade via SessionManager

### Order Management
- `get_active_orders()` — List SL/TP orders
- `cancel_order(orderId)` — Revoke WETH allowance
- `get_session()` — Session budget and expiry

### Memory
- `update_memory(section, content)` — Persist to `data/memory/{wallet}/{profile|patterns|decisions}.md`

---

## Key Data Flows

### 1. User Chat → AI Trade

```
User message
  → POST /api/chat
  → LLM reasoning (up to 5 tool-call rounds)
  → executor.ts routes tool calls to chain modules
  → Tx signed with server private key
  → Response with tool_results[] + AI explanation
```

### 2. VPS Signal → Autonomous Trade

```
VPS 15-min cycle:
  fetchCrucix() + fetchNews()
  → LLM analysis → {push_worthy, alerts}

IF push_worthy:
  → POST /api/auto-trade (Bearer token auth)
  → LLM decides: session_swap / set_stop_loss / hold
  → SSE broadcast SIGNAL_ALERT to all clients
  → ChatWindow appends system message
```

### 3. Reactive Order Execution

```
User sets SL at $2000 for 0.1 WETH
  → Approve WETH to callback (Base)
  → Deploy BaseStopOrderReactive (Reactive Network 1597)

PairOrderManager monitors Uniswap Sync events
  → Price drops ≤ $2000
  → Triggers StopOrderCallback.execute() on Base
  → Callback swaps 0.1 WETH → USDC to user

EventIndexer detects Stop event
  → SSE broadcast ORDER_EXECUTED
  → Chat displays "Order filled" with TX hash
```

### 4. VPS Patrol Report (3h cycle)

```
Every 12 signal cycles (3 hours):
  → VPS summarizes all decisions + market changes
  → POST /api/patrol-report
  → SSE broadcast PATROL_REPORT
  → Dashboard + Chat display summary
```

---

## SSE Event Types

| Event | Source | Trigger |
|-------|--------|---------|
| `SIGNAL_ALERT` | SignalHub | VPS push_worthy signal |
| `ORDER_EXECUTED` | EventIndexer | Callback contract fired |
| `DECISION_MADE` | auto-trade API | AI autonomous trade |
| `PATROL_REPORT` | VPS | 3h summary cycle |

---

## VPS Intelligence Pipeline (`vps-api-index.mjs`)

### Data Sources (27+)

| Category | Sources |
|----------|---------|
| Macro | FRED (VIX, CPI, yields), GDELT, ACLED (geopolitics) |
| Markets | Crypto prices, Uniswap quotes, OKX |
| Energy | WTI crude, natural gas |
| Sentiment | Twitter, Telegram, crypto news (OpenNews) |

### Pipeline

```
Every 15 minutes:
  1. fetchCrucix()  → Aggregated market data from localhost:3117
  2. fetchNews()    → AI-scored crypto news
  3. llm()          → GPT-5.4-mini analysis
  4. Output: { macro_risk_score, sentiment, alerts[], recommended_action, push_worthy }

Every 3 hours (12 cycles):
  5. generatePatrolReport() → Summarize decisions + market shifts
  6. pushPatrolReport()     → POST to frontend /api/patrol-report

Event-driven:
  7. IF push_worthy → triggerAutoTrade() → POST /api/auto-trade
```

### VPS API Routes (Port 3200)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/signals` | Latest cached analysis |
| `GET /api/analysis` | Full analysis + token counts |
| `GET /api/health` | Uptime, last update, model info |
| `POST /api/refresh` | Force immediate re-analysis |

---

## Smart Contracts

### SessionVault.sol
- User grants AI wallet (session key) permission to trade
- Constraints: `maxPerTrade`, `totalBudget`, `expiresAt`
- `createSession()` / `revokeSession()` / `spendFromSession()`

### OrderRegistry.sol
- On-chain order ledger with `orderId`
- `createOrder()` → Issues ID, stores metadata
- `markExecutedAndCancelLinked()` → Callback marks executed, cancels linked SL/TP pair

### StopOrderCallback.sol (Base)
- Abstract callback listening to Reactive Network events
- `execute()` → Checks price against threshold → Uniswap swap to user wallet
- Events: `Executed`, `ExecutionFailed`

### PairOrderManager.sol (Reactive Network)
- Monitors Base Uniswap `Sync` events (price updates)
- Monitors Base `OrderRegistry` events (create/cancel)
- Triggers callback when price condition met
- Manages order state: active → triggered / cancelled

---

## Environment Variables

### Web (`web/.env.local`)
```
LLM_ENDPOINT          # OpenAI-compatible API URL
LLM_API_KEY           # API key
LLM_MODEL             # Model name (gpt-5.4)
VPS_API_URL            # VPS intelligence endpoint
BASE_RPC_URL           # Base chain RPC
PRIVATE_KEY            # Server wallet private key
REACTIVE_RPC           # Reactive Network RPC
+ Contract addresses (CALLBACK, ROUTER, WETH, USDC, PAIR, PROXY, SESSION_MANAGER)
```

### VPS (`vps-api/.env`)
```
PORT=3200
CRUCIX_URL             # Data aggregator endpoint
LLM_BASE_URL / KEY / MODEL
OPENNEWS_TOKEN         # News API token
AUTO_TRADE_URL         # Frontend auto-trade endpoint
AUTO_TRADE_SECRET      # Bearer token for auth
```

---

## Authentication & Security

- **User auth**: Wallet-based via ConnectKit (no login/password)
- **Backend signing**: Server-side private key for trade execution
- **Auto-trade auth**: Bearer token (`AUTO_TRADE_SECRET`) between VPS and frontend
- **Session budget**: On-chain enforcement via SessionManager (maxPerTrade, totalBudget, expiry)
- **Memory isolation**: Per-wallet directories under `data/memory/{address}/`
