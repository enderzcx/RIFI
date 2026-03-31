# RIFI Architecture

> AI decides. Reactive executes.

---

## System Overview (V3)

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
│  ┌──────────┐  ┌────────────────┐  ┌───────────────┐             │
│  │ /api/chat│  │/api/auto-trade │  │ /api/portfolio│             │
│  │ SSE      │  │  Coordinator   │  │ /api/tasks    │             │
│  └─────┬────┘  └──────┬────────┘  └───────────────┘             │
│        │               │                                          │
│        │         ┌─────▼──────────────────────────┐              │
│        │         │     COORDINATOR (lib/agents/)    │              │
│        │         │                                  │              │
│        │         │  Stage 1: Analyst Agent          │              │
│        │         │    tools: signals,price,news     │              │
│        │         │    output: verdict + confidence  │              │
│        │         │            │                     │              │
│        │         │  Stage 2: Strategist Agent       │              │
│        │         │    tools: portfolio,session,orders│              │
│        │         │    output: direction,amount,SL/TP│              │
│        │         │            │                     │              │
│        │         │  Stage 3: Executor Agent         │              │
│        │         │    tools: swap,stop_loss,tp      │              │
│        │         │    output: txHash + summary      │              │
│        │         └─────┬──────────────────────────┘              │
│        │               │                                          │
│  ┌─────▼───────────────▼──────────────────────────┐              │
│  │       LLM ENGINE (lib/llm/) + HOOKS            │              │
│  │                                                  │              │
│  │  ┌─────────────────────────────────────┐        │              │
│  │  │ Pre-trade Hooks (lib/hooks/)        │        │              │
│  │  │  amount-limit → balance-guard →     │        │              │
│  │  │  cooldown → session-budget-warn     │        │              │
│  │  └─────────────────┬───────────────────┘        │              │
│  │                    ▼                             │              │
│  │  executeTool(name, args, userAddress)            │              │
│  │    ├── canServerExecute? → direct execution     │              │
│  │    └── else → return sign_request (unsigned tx) │              │
│  │                    │                             │              │
│  │  ┌─────────────────▼───────────────────┐        │              │
│  │  │ Post-trade Hooks                    │        │              │
│  │  │  record-cooldown → execution-monitor│        │              │
│  │  │  → failure-logger → audit-trail     │        │              │
│  │  └─────────────────────────────────────┘        │              │
│  └─────┬──────────────────────────────────────────┘              │
│        │ Tool Calls                                               │
│  ┌─────▼──────────────────────────────────────────┐              │
│  │          CHAIN LAYER (lib/chain/)               │              │
│  │                                                  │              │
│  │  portfolio.ts  → getPortfolio(walletAddress?)   │              │
│  │  swap.ts       → marketSwap() / buildSwapTxs() │              │
│  │  stop-order.ts → setStopLoss(client?)           │              │
│  │  session.ts    → sessionSwap(userAddress)       │              │
│  │  price.ts      → getPrice() from Uniswap Pair  │              │
│  └─────┬──────────────────────────────────────────┘              │
│        │                                                          │
│  ┌─────▼──────────┐  ┌───────────────┐  ┌──────────────┐        │
│  │ EventIndexer   │  │  PushService  │  │   Memory     │        │
│  │ (Persistent)   │  │  (SSE bcast)  │  │ (7 sections) │        │
│  │ → orders.json  │  └───────────────┘  │ (with decay) │        │
│  └────────────────┘                     └──────────────┘        │
│        │                                                          │
│  ┌─────▼──────────┐                                              │
│  │ Task Manager   │  tasks.json — background task tracking       │
│  │ (lib/tasks/)   │  order_monitor / signal_poll / coordinator   │
│  └────────────────┘                                              │
└────────────────────────────────────────────────────────────────────┘
         │                                         ▲
         ▼                                         │
┌────────────────────┐                ┌────────────┴─────────────┐
│   BASE CHAIN (L2)  │                │   VPS INTELLIGENCE       │
│   Chain ID: 8453   │                │   (vps-api-index.mjs)    │
│                    │                │                          │
│  SessionManagerV2  │                │  15min: Analyst → Risk → │
│  StopOrderCallback │                │    Executor/Strategist   │
│  OrderRegistry     │                │  3h: Patrol Report       │
│  Uniswap V2 Router │                │  Weekly: Reviewer        │
│  WETH / USDC       │                │                          │
└────────┬───────────┘                │  push_worthy signal →    │
         │ Reactive Events            │  POST /api/auto-trade →  │
┌────────▼───────────┐                │  Coordinator pipeline    │
│ REACTIVE NETWORK   │                └──────────────────────────┘
│ Chain ID: 1597     │
│                    │
│ PairOrderManager   │
│ (Monitor Sync →    │
│  Trigger Callback) │
└────────────────────┘
```

---

## V3 New Modules

### Hook System (`lib/hooks/`)

Trade lifecycle hooks that run before and after every write operation:

```
Pre-trade (short-circuit on block):
  1. amount-limit     — single trade max: 0.5 WETH / 1000 USDC
  2. balance-guard    — ensure reserve balance + gas
  3. cooldown         — 30s between trades, 60s same direction
  4. session-budget   — warn at 90% session budget spent

Post-trade (all run, no short-circuit):
  1. record-cooldown  — update cooldown timestamps
  2. execution-monitor — warn if tool took >15s (RPC congestion)
  3. failure-logger   — structured error logging
  4. audit-trail      — JSON audit log for every trade
```

Configurable via `risk-config.ts` — no code changes needed to adjust thresholds.

### Multi-Agent Coordinator (`lib/agents/`)

Three-stage pipeline for autonomous trade execution:

```
Signal arrives (from VPS or user chat)
     │
     ▼
┌─────────────────────────────────────────────────┐
│ Stage 1: Analyst Agent                          │
│ Tools: get_market_signals, get_price,           │
│        get_portfolio, get_crypto_news,           │
│        get_crucix_data, get_onchain_data         │
│ Output: { action, confidence, risk_score }       │
│ Gate: confidence < 50 → STOP (hold)             │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ Stage 2: Strategist Agent                       │
│ Tools: get_price, get_portfolio, get_session,   │
│        get_active_orders                         │
│ Output: { direction, amount, stop_loss, tp }     │
│ Gate: direction = hold → STOP                    │
│ Rule: never >30% of balance in one trade        │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ Stage 3: Executor Agent                         │
│ Tools: get_price, get_portfolio, get_session,   │
│        session_swap, set_stop_loss, set_take_profit │
│ Output: txHash + summary                         │
│ Guard: price drift >2% since analysis → SKIP    │
│ Hooks: pre-trade + post-trade run automatically  │
└─────────────────────────────────────────────────┘
```

### Task System + Persistence (`lib/tasks/`)

```
JsonStore<T> — generic JSON file persistence (zero deps)
  ├── tasks.json   — background task tracking
  └── orders.json  — order state (survives server restart)

Task lifecycle: pending → running → completed | failed | cancelled

Task types:
  order_monitor  — event-indexer polling
  signal_poll    — signal hub polling
  patrol         — VPS patrol cycle
  coordinator    — multi-agent coordinator run
  backtest       — strategy backtesting
  custom         — user-defined
```

### Enhanced Memory (`lib/memory/`)

7 memory sections per wallet (up from 3):

| Section | Decay | Purpose |
|---------|-------|---------|
| `profile` | never | User preferences, risk tolerance |
| `patterns` | never | Trading lessons learned |
| `decisions` | never | Important trade records |
| `market_regime` | **3 days** | Current market state (auto-expires) |
| `strategy_feedback` | **30 days** | Strategy performance notes |
| `risk_lesson` | **never** | Permanent risk lessons |
| `reference` | manual | External resource pointers |

All entries auto-tagged with `[YYYY-MM-DD]`. Expired entries filtered on read, prunable on demand.

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
| SessionManagerV2 | `0x3421...611` | Budget enforcement + executeCall + whitelisted targets |
| StopOrderCallback | `0x9702...f3` | Executes SL/TP: double price verify, try-catch swap |
| OrderRegistry | `0xcE97...98` | Order ledger with OCO (one-cancels-other) linked orders |
| Callback Proxy | `0x0D3E...47` | Reactive Network official proxy |

### Reactive Mainnet (1597)

| Contract | Address | Role |
|----------|---------|------|
| PairOrderManager | deployed per order | Subscribes to Uniswap Sync events, triggers callback when price condition met |

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

## Sentinel Mode (V3 — Coordinator)

```
VPS runs every 15 minutes:

┌─────────────────────────┐
│ VPS Analyst Agent       │ ← Crucix 27src + OpenNews + OKX WebSocket
│ → structured signal     │
│ → push_worthy?          │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│ VPS Risk Agent          │
│ → PASS / VETO           │
└───────────┬─────────────┘
            │ (if PASS + push_worthy)
            ▼
POST /api/auto-trade (Bearer token auth)
            │
┌───────────▼─────────────────────────────────┐
│ Next.js Coordinator (NEW in V3)             │
│                                              │
│  Analyst → Strategist → Executor            │
│  (each with restricted tools + hooks)       │
│                                              │
│  Gate 1: Analyst confidence < 50 → hold     │
│  Gate 2: Strategist direction = hold → stop │
│  Gate 3: Pre-trade hooks (amount/balance)   │
│  Gate 4: Post-trade hooks (audit/cooldown)  │
└───────────┬─────────────────────────────────┘
            ▼
SSE broadcast to all connected clients
```

---

## File Structure (V3)

```
RIFI/
├── src/                              # Smart Contracts (Solidity)
│   ├── StopOrderCallback.sol         # Base callback + SafeERC20 + try-catch
│   ├── PairOrderManager.sol          # Reactive event monitor
│   ├── OrderRegistry.sol             # Order ledger + OCO
│   ├── SessionManagerV2.sol          # Session key + executeCall + whitelist
│   └── SessionVault.sol              # Legacy session budget enforcement
│
├── script/
│   ├── DeployBaseStopOrder.s.sol     # Base + Reactive deployment
│   └── DeploySessionManagerV2.s.sol  # V2 deployment script
│
├── web/
│   ├── src/app/
│   │   ├── page.tsx                  # Landing page
│   │   ├── chat/page.tsx             # Chat layout (3-col)
│   │   ├── dashboard/page.tsx        # PnL + stats dashboard
│   │   └── api/
│   │       ├── chat/route.ts         # SSE streaming chat + tool execution
│   │       ├── auto-trade/route.ts   # Coordinator pipeline (V3)
│   │       ├── tasks/route.ts        # Task CRUD API (V3)
│   │       ├── portfolio/route.ts    # ?wallet= param support
│   │       ├── orders/route.ts       # ?wallet= filter by client
│   │       ├── prices/route.ts       # Current WETH/USDC price
│   │       ├── trades/route.ts       # Trade history + stats
│   │       ├── sentinel-mode/route.ts# GET/POST mode toggle
│   │       ├── news/route.ts         # Proxy VPS news
│   │       ├── crucix/route.ts       # Proxy VPS Crucix
│   │       ├── events/route.ts       # SSE push for auto-trade
│   │       └── signals/route.ts      # Proxy VPS signals
│   │
│   ├── src/components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx        # Streaming chat + sign_request
│   │   │   └── ToolCallCard.tsx      # Lucide icon tool cards
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # Nav + chat history
│   │   │   └── RightPanel.tsx        # Portfolio + orders + sentinel
│   │   └── providers/
│   │       └── Web3Provider.tsx      # Wagmi + ConnectKit (Base + RNK)
│   │
│   └── src/lib/
│       ├── agents/                   # V3: Multi-Agent Coordinator
│       │   ├── types.ts             # AgentRole, Scratchpad, AgentResult
│       │   ├── runner.ts            # Generic runAgent() loop
│       │   ├── coordinator.ts       # Analyst → Strategist → Executor
│       │   ├── prompts.ts           # Per-agent system prompts
│       │   ├── tool-sets.ts         # Restricted tool subsets per agent
│       │   └── index.ts
│       ├── hooks/                    # V3: Trade Lifecycle Hooks
│       │   ├── types.ts             # HookDef, PreTradeContext, PostTradeContext
│       │   ├── registry.ts          # registerHook(), runHooks(), isWriteTool()
│       │   ├── pre-trade.ts         # 4 pre-trade hooks
│       │   ├── post-trade.ts        # 4 post-trade hooks
│       │   ├── risk-config.ts       # Configurable thresholds
│       │   └── index.ts
│       ├── tasks/                    # V3: Task System + Persistence
│       │   ├── types.ts             # Task, TaskType, TaskStatus
│       │   ├── store.ts             # JsonStore<T> (zero-dep file persistence)
│       │   ├── manager.ts           # CRUD + lifecycle management
│       │   └── index.ts
│       ├── llm/
│       │   ├── executor.ts          # executeTool() + hook integration (V3)
│       │   ├── tools.ts             # 18 tool definitions
│       │   ├── system-prompt.ts     # AI persona + rules
│       │   └── client.ts            # OpenAI-compatible client
│       ├── chain/
│       │   ├── config.ts            # Addresses + ABIs + clients
│       │   ├── portfolio.ts         # getPortfolio(walletAddress?)
│       │   ├── swap.ts              # marketSwap() + buildSwapTxs()
│       │   ├── stop-order.ts        # setStopLoss(client?) + buildStopLossTxs()
│       │   ├── session.ts           # sessionSwap(userAddress)
│       │   ├── price.ts             # Uniswap pair reserves
│       │   └── event-indexer.ts     # Persistent order tracking (V3)
│       ├── sse/
│       │   ├── push-service.ts      # SSE broadcast singleton
│       │   └── signal-hub.ts        # VPS poll → classify → push
│       └── memory/
│           └── index.ts             # 7-section memory with decay (V3)
│
├── data/                             # V3: Persistent state (gitignored)
│   ├── orders.json                  # Order state (survives restart)
│   ├── tasks.json                   # Background task state
│   └── memory/{wallet}/             # Per-wallet memory files
│
├── vps-api-index.mjs                # VPS intelligence pipeline (5 agents)
├── docs/
│   ├── ARCHITECTURE.md              # Detailed architecture (this file)
│   ├── ROADMAP-V2.md                # V2 roadmap (completed)
│   └── TODO.md                      # Current TODOs
├── README.md                        # Project overview
└── foundry.toml                     # Forge config
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI-compatible LLM (Claude, GPT-5.4, Ollama) |
| Agent Framework | Custom coordinator + runner (lib/agents/) |
| Trade Safety | Hook system (lib/hooks/) with configurable risk gates |
| Blockchain | Base (8453) + Reactive Network (1597) |
| Contracts | Solidity 0.8+, Foundry, OpenZeppelin (SafeERC20) |
| CEX | Bitget (spot + futures) |
| Cross-chain | LiFi SDK (60+ chains) |
| Real-time | Server-Sent Events (SSE) |
| Intelligence | 27+ OSINT sources via Crucix engine |
| Persistence | JSON file store (orders, tasks) + file-based memory |
