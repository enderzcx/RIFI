# RIFI Architecture

> AI decides. Reactive executes.

---

## System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                         USER (Browser)                             │
│                                                                    │
│  ┌──────────┐  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │ Sidebar   │  │     Chat Window      │  │    Right Panel       │ │
│  │ History   │  │  AI Streaming Chat   │  │  Portfolio / Market  │ │
│  │ Nav       │  │  Tool Cards          │  │  Sentinel / Session  │ │
│  └──────────┘  └──────────┬───────────┘  └──────────────────────┘ │
│                            │                                       │
│         ┌──────────────────┼──────────────────┐                    │
│         │ No Session Key   │  Session Key     │                    │
│         │ → sign_request   │  → auto execute  │                    │
│         │ → MetaMask popup │  → no signature  │                    │
│         └──────────────────┼──────────────────┘                    │
└────────────────────────────┼───────────────────────────────────────┘
                             │ POST /api/chat (SSE stream)
                             │ userAddress in body
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS SERVER                                  │
│                                                                    │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐               │
│  │ /api/chat│  │/api/auto-trade│  │ /api/portfolio│               │
│  │ SSE stream│  │ Sentinel Mode│  │ ?wallet=0x... │               │
│  └─────┬────┘  └──────┬───────┘  └───────────────┘               │
│        │               │                                           │
│  ┌─────▼───────────────▼──────────────────────────┐               │
│  │           LLM ENGINE (lib/llm/)                 │               │
│  │  system-prompt → tools → executor               │               │
│  │                                                  │               │
│  │  executeTool(name, args, userAddress)            │               │
│  │    ├── canServerExecute? → direct execution     │               │
│  │    └── else → return sign_request (unsigned tx) │               │
│  └─────┬──────────────────────────────────────────┘               │
│        │ Tool Calls                                                │
│  ┌─────▼──────────────────────────────────────────┐               │
│  │          CHAIN LAYER (lib/chain/)               │               │
│  │                                                  │               │
│  │  portfolio.ts  → getPortfolio(walletAddress?)   │               │
│  │  swap.ts       → marketSwap() / buildSwapTxs() │               │
│  │  stop-order.ts → setStopLoss(client?) /         │               │
│  │                  buildStopLossTxs()             │               │
│  │  session.ts    → sessionSwap(userAddress)       │               │
│  │  price.ts      → getPrice() from Uniswap Pair  │               │
│  └─────┬──────────────────────────────────────────┘               │
│        │                                                           │
│  ┌─────▼──────────┐  ┌───────────────┐  ┌──────────────┐         │
│  │ EventIndexer   │  │  PushService  │  │   Memory     │         │
│  │ (Poll orders)  │  │  (SSE bcast)  │  │ (per-wallet) │         │
│  └────────────────┘  └───────────────┘  └──────────────┘         │
└────────────────────────────────────────────────────────────────────┘
         │                                         ▲
         ▼                                         │
┌────────────────────┐                ┌────────────┴─────────────┐
│   BASE CHAIN (L2)  │                │   VPS INTELLIGENCE       │
│   Chain ID: 8453   │                │   (vps-api-index.mjs)    │
│                    │                │                          │
│  SessionManager    │                │  15min: fetch → LLM →    │
│  StopOrderCallback │                │    signal analysis       │
│  OrderRegistry     │                │  3h: patrol report       │
│  Uniswap V2 Router │                │  Event: push_worthy →   │
│  WETH / USDC       │                │    POST /api/auto-trade  │
└────────┬───────────┘                │                          │
         │ Reactive Events            │  Sentinel Mode:          │
┌────────▼───────────┐                │  Conservative / Aggressive│
│ REACTIVE NETWORK   │                │                          │
│ Chain ID: 1597     │                │  27+ sources:            │
│                    │                │  FRED, GDELT, OKX,       │
│ PairOrderManager   │                │  Twitter, News           │
│ (Monitor Sync →    │                └──────────────────────────┘
│  Trigger Callback) │
└────────────────────┘
```

---

## Multi-Wallet Architecture

```
User connects wallet (any address)
         │
         ▼
Frontend sends userAddress to /api/chat
         │
         ▼
Executor checks: does this wallet have an active Session?
         │
    ┌────┴────┐
    ▼         ▼
  YES         NO
    │          │
    │     Return sign_request
    │     (unsigned tx data)
    │          │
    │     Frontend prompts
    │     MetaMask to sign
    │          │
    ▼          ▼
Server executes         User signs
(as Session executor)   (via MetaMask)
    │          │
    └────┬─────┘
         ▼
    On-chain TX
```

---

## Contract Architecture

### Base Mainnet (8453)

| Contract | Address | Role |
|----------|---------|------|
| SessionManager | `0x5810...0e` | Budget enforcement: maxPerTrade, totalBudget, expiry |
| StopOrderCallback | `0x9702...f3` | Executes SL/TP: double price verify, configurable slippage, try-catch swap |
| OrderRegistry | `0xcE97...98` | Order ledger with OCO (one-cancels-other) linked orders |
| Callback Proxy | `0x0D3E...47` | Reactive Network official proxy |

### Reactive Mainnet (1597)

| Contract | Address | Role |
|----------|---------|------|
| PairOrderManager | `0x3421...11` | Subscribes to Uniswap Sync events, triggers callback when price condition met |

### Execution Flow

```
1. User creates Session → approves WETH/USDC to Router + Callback
2. AI calls set_stop_loss(amount, threshold, clientAddress)
3. Server deploys Reactive contract on RNK (client = user's address)
4. PairOrderManager monitors Sync events on Base
5. Price <= threshold → triggers StopOrderCallback.execute() on Base
6. Callback: re-verify price → transferFrom user → swap → send to user
7. If swap fails: safeTransfer tokens back to user (no funds lost)
```

---

## Sentinel Mode

```
VPS runs every 15 minutes:

┌─────────────────────────┐
│ fetchCrucix() (27 src)  │ ← FRED, GDELT, ACLED, OKX, Reddit, Telegram...
│ fetchNews() (OpenNews)  │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ LLM Analysis            │
│ → macro_risk_score      │
│ → crypto_sentiment      │
│ → technical_bias        │
│ → recommended_action    │
│ → confidence (0-100)    │
│ → push_worthy (bool)    │
└───────────┬─────────────┘
            ▼
┌─────────────────────────────────────────┐
│ Conservative: push_worthy + FLASH only  │
│ Aggressive:   confidence > 50 +         │
│               actionable signal         │
└───────────┬─────────────────────────────┘
            ▼
POST /api/auto-trade (Bearer token auth)
→ LLM decides: session_swap / set_stop_loss / hold
→ SSE broadcast to all connected clients
```

---

## File Structure

```
RIFI/
├── src/                              # Smart Contracts (Solidity)
│   ├── StopOrderCallback.sol         # Base callback + SafeERC20 + try-catch
│   ├── PairOrderManager.sol          # Reactive event monitor
│   ├── OrderRegistry.sol             # Order ledger + OCO
│   └── SessionVault.sol              # Session key budget enforcement
│
├── script/
│   └── DeployBaseStopOrder.s.sol     # Base + Reactive deployment
│
├── web/
│   ├── src/app/
│   │   ├── page.tsx                  # Landing page (video bg + hero)
│   │   ├── chat/page.tsx             # Chat layout (3-col + bg wave)
│   │   └── api/
│   │       ├── chat/route.ts         # SSE streaming chat + tool execution
│   │       ├── auto-trade/route.ts   # Sentinel auto-trade endpoint
│   │       ├── portfolio/route.ts    # ?wallet= param support
│   │       ├── orders/route.ts       # ?wallet= filter by client
│   │       ├── sentinel-mode/route.ts# GET/POST mode toggle
│   │       ├── news/route.ts         # Proxy VPS news (OpenNews 6551.io)
│   │       ├── crucix/route.ts       # Proxy VPS Crucix raw data
│   │       ├── events/route.ts       # SSE push for auto-trade events
│   │       └── signals/route.ts      # Proxy VPS signals
│   │
│   ├── src/components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx        # Streaming chat + sign_request handler
│   │   │   └── ToolCallCard.tsx      # Lucide icon tool cards
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # Nav + chat history
│   │   │   └── RightPanel.tsx        # Portfolio + orders + sentinel + session
│   │   └── providers/
│   │       └── Web3Provider.tsx      # Wagmi + ConnectKit (Base + RNK)
│   │
│   └── src/lib/
│       ├── llm/
│       │   ├── executor.ts           # executeTool(name, args, userAddress)
│       │   ├── tools.ts              # 14 tool definitions
│       │   ├── system-prompt.ts      # AI persona + rules
│       │   └── client.ts            # OpenAI-compatible client
│       ├── chain/
│       │   ├── config.ts            # Addresses + ABIs + clients
│       │   ├── portfolio.ts         # getPortfolio(walletAddress?)
│       │   ├── swap.ts              # marketSwap() + buildSwapTxs()
│       │   ├── stop-order.ts        # setStopLoss(client?) + buildStopLossTxs()
│       │   ├── session.ts           # sessionSwap(userAddress)
│       │   ├── price.ts             # Uniswap pair reserves
│       │   └── event-indexer.ts     # Poll + track orders
│       ├── sse/
│       │   ├── push-service.ts      # SSE broadcast singleton
│       │   └── signal-hub.ts        # VPS poll → classify → push
│       └── memory/
│           └── index.ts             # Per-wallet file storage
│
├── vps-api-index.mjs                # VPS intelligence pipeline
├── README.md                        # Project overview
├── DEMO-SCRIPT.md                   # 5-min demo script
└── foundry.toml                     # Forge config
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI-compatible LLM |
| Blockchain | Base (8453) + Reactive Network (1597) |
| Contracts | Solidity 0.8+, Foundry, OpenZeppelin (SafeERC20) |
| Real-time | Server-Sent Events (SSE) |
| Intelligence | 27+ OSINT sources via Crucix engine |
