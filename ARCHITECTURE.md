# RIFI Architecture

> AI decides. Reactive executes.

---

## System Overview (V3.1)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER (Browser)                                  │
│  ┌──────────┐  ┌──────────────────────┐  ┌────────────────────────────┐│
│  │ Sidebar   │  │     Chat Window      │  │      Right Panel           ││
│  │ History   │  │  AI Streaming Chat   │  │  Portfolio / Prices        ││
│  │ Nav       │  │  Tool Cards          │  │  Orders / Session          ││
│  └──────────┘  └──────────┬───────────┘  └────────────────────────────┘│
└────────────────────────────┼──────────────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           ▼                                   ▼
┌─────────────────────┐          ┌──────────────────────────────────────┐
│   NEXT.JS SERVER    │          │         VPS INTELLIGENCE             │
│   (web/)            │◄────────►│    (vps-api-index.mjs — 3100 lines) │
│                     │  HTTP    │                                      │
│  14 API routes      │          │  59 functions / 29 routes            │
│  55 TS files        │          │  7 AI Agents / 6 tools per analyst   │
└─────────┬───────────┘          └──────────┬───────────────────────────┘
          │                                 │
          ▼                                 ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   BASE (8453)    │  │ REACTIVE (1597)  │  │  BITGET CEX      │
│  Uniswap V2     │  │ PairOrderManager │  │  Spot + Futures  │
│  SessionMgrV2   │  │ (SL/TP monitor)  │  │  540+ pairs      │
│  OrderRegistry  │  └──────────────────┘  │  Scanner + Exec  │
│  StopCallback   │                        └──────────────────┘
└──────────────────┘
```

---

## VPS Agent Architecture (核心大脑)

```
┌─────────────────────────────────────────────────────────────────┐
│                    VPS INTELLIGENCE PIPELINE                     │
│                    (vps-api-index.mjs)                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   DATA COLLECTION (每15分钟)              │   │
│  │  Crucix (27源) + OpenNews (6551.io) + OKX WebSocket     │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ANALYST AGENT (6 tools)                      │   │
│  │  get_crucix_data      — VIX, S&P500, gold, geopolitics   │   │
│  │  get_crypto_news      — AI-scored sentiment               │   │
│  │  get_prices           — BTC/ETH/SOL realtime (OKX WS)    │   │
│  │  get_technical_indicators — EMA/RSI/MACD/ATR/BB/Fib0.31  │   │
│  │  get_trade_performance — win rate, PnL, guidance          │   │
│  │                                                            │   │
│  │  Output: { action, confidence, entry_zone, SL, TP,        │   │
│  │           key_levels, push_worthy }                        │   │
│  │  5-dim framework: macro/tech/news/OI/fib031               │   │
│  │  Self-evolution: auto-conservative on 3+ losses           │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         ▼                                        │
│           ┌──── push_worthy OR (conf>=75 + strong action)       │
│           │                                                      │
│  ┌────────▼─────────────────────────────────────────────────┐   │
│  │              RISK AGENT (fail-closed)                      │   │
│  │  Hard rules (code-enforced, cannot be bypassed):          │   │
│  │    • 3+ consecutive losses → 1h cooldown                  │   │
│  │    • 24h loss > 5% of equity → VETO                       │   │
│  │    • Position already exists same direction → skip         │   │
│  │  Soft rules (LLM-evaluated):                              │   │
│  │    • Confidence check, signal alignment                   │   │
│  │  Error handling: defaults to VETO (fail-closed)           │   │
│  └────────┬──────────┬──────────────────────────────────────┘   │
│           │          │                                           │
│      PASS ▼     VETO ▼                                          │
│  ┌────────────┐  (logged)                                       │
│  │ EXECUTORS  │                                                  │
│  │            │                                                  │
│  │ ┌────────────────────────────────────┐                       │
│  │ │ BitgetExec (CEX, 主力)             │                       │
│  │ │  ETH futures, 10x leverage        │                       │
│  │ │  Trading mutex (防竞态)            │                       │
│  │ │  Position check before open       │                       │
│  │ └────────────────────────────────────┘                       │
│  │ ┌────────────────────────────────────┐                       │
│  │ │ On-chain Executor (备用)           │                       │
│  │ │  POST /api/auto-trade →           │                       │
│  │ │  Next.js Coordinator pipeline     │                       │
│  │ └────────────────────────────────────┘                       │
│  └────────────┘                                                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           SCANNER (每15分钟, 与Analyst并行)               │   │
│  │  1. Scan 540+ Bitget futures pairs                       │   │
│  │  2. Filter: vol > $5M, change > 2% → ~35 candidates     │   │
│  │  3. Top 10: fetch 1H candles → RSI/MA/BB/support/resist  │   │
│  │  4. Check margin: available < $2 →                       │   │
│  │     auto-cancel stale pending orders → free margin       │   │
│  │  5. LLM picks 1 best setup → all-in ($2.5 margin, 10x)  │   │
│  │  6. Place limit order with order-level TP/SL             │   │
│  │  7. Record to trades + decisions table                   │   │
│  │  Trading mutex shared with BitgetExec                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              OTHER AGENTS                                 │   │
│  │                                                            │   │
│  │  Strategist — evaluates active strategies vs market       │   │
│  │  Reviewer   — 3h patrol reports + PnL summary             │   │
│  │  Weekly     — weekly self-review + strategy adjustment    │   │
│  │  Learning   — signal scoring + lesson injection           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              INFRASTRUCTURE                               │   │
│  │  SQLite DB: trades, decisions, news, analysis, candles,  │   │
│  │             patrol_reports, strategies, signal_scores,    │   │
│  │             lessons, agent_messages, agent_metrics        │   │
│  │  OKX WebSocket: BTC/ETH/SOL real-time prices            │   │
│  │  5-min candle buffer → SQLite                            │   │
│  │  Price anomaly detection (5min > 2% → instant analysis)  │   │
│  │  Per-agent model allocation (analyst/risk/strategist/    │   │
│  │    executor/reviewer — each can use different model)      │   │
│  │  LiFi SDK: cross-chain swaps (Base/ETH/BSC)             │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Next.js Server Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    NEXT.JS SERVER (web/)                          │
│                                                                   │
│  API Routes (14):                                                │
│  ├── /api/chat          — SSE streaming chat + tool execution    │
│  ├── /api/auto-trade    — Coordinator pipeline (from VPS)        │
│  ├── /api/tasks         — Task CRUD (authenticated)              │
│  ├── /api/portfolio     — Wallet balances                        │
│  ├── /api/orders        — Active SL/TP orders                    │
│  ├── /api/prices        — Current WETH/USDC price                │
│  ├── /api/trades        — Trade history + stats                  │
│  ├── /api/sentinel-mode — Toggle auto-trade mode                 │
│  ├── /api/events        — SSE push for auto-trade events         │
│  ├── /api/news          — Proxy VPS news                         │
│  ├── /api/crucix        — Proxy VPS Crucix                       │
│  ├── /api/signals       — Proxy VPS signals (crypto/stock)       │
│  └── /api/patrol-report — Receive patrol reports                 │
│                                                                   │
│  Core Libraries:                                                 │
│  ├── lib/agents/        — Multi-Agent Coordinator                │
│  │   ├── coordinator.ts — Analyst → Strategist → Executor        │
│  │   ├── runner.ts      — Generic agent loop                     │
│  │   ├── prompts.ts     — Per-agent system prompts               │
│  │   └── tool-sets.ts   — Restricted tools per agent             │
│  │                                                                │
│  ├── lib/hooks/         — Trade Lifecycle Hooks                  │
│  │   ├── pre-trade.ts   — amount-limit, balance, cooldown, budget│
│  │   ├── post-trade.ts  — cooldown, monitor, failure, audit      │
│  │   └── risk-config.ts — Thresholds (SL:TP >= 1:2)             │
│  │                                                                │
│  ├── lib/tasks/         — Persistence Layer                      │
│  │   ├── store.ts       — JsonStore (debounced, corruption-safe) │
│  │   └── manager.ts     — Task lifecycle                         │
│  │                                                                │
│  ├── lib/llm/           — LLM Engine                             │
│  │   ├── executor.ts    — executeTool() + hooks integration      │
│  │   ├── tools.ts       — 18 tool definitions                    │
│  │   └── system-prompt.ts — AI persona + rules                   │
│  │                                                                │
│  ├── lib/chain/         — On-chain Operations (Base)             │
│  │   ├── swap.ts        — Uniswap V2 market swap                │
│  │   ├── stop-order.ts  — Reactive SL/TP deployment             │
│  │   ├── session.ts     — SessionManager swap                   │
│  │   ├── event-indexer.ts — Order monitoring (persistent)        │
│  │   └── config.ts      — Addresses + ABIs + RPC clients        │
│  │                                                                │
│  ├── lib/sse/           — Real-time Push                         │
│  │   ├── push-service.ts — SSE broadcaster                      │
│  │   └── signal-hub.ts   — VPS signal polling                   │
│  │                                                                │
│  └── lib/memory/        — Per-wallet Memory (7 sections)         │
│      └── index.ts       — Read/write with decay (3d/30d/perm)   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Smart Contract Architecture

### Base Mainnet (8453)

| Contract | Address | Role |
|----------|---------|------|
| SessionManagerV2 | `0x3421...611` | Budget enforcement + executeCall + whitelisted targets |
| StopOrderCallback | `0x9702...f3` | Executes SL/TP: double price verify, try-catch swap |
| OrderRegistry | `0xcE97...98` | Order ledger with OCO (one-cancels-other) linked orders |
| Callback Proxy | `0x0D3E...47` | Reactive Network official proxy |

### Reactive Mainnet (1597)

| Contract | Role |
|----------|------|
| PairOrderManager | Deployed per order. Subscribes to Uniswap Sync events, triggers callback when price condition met |

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

## Trading Safety Stack

```
                    Signal arrives
                         │
    ┌────────────────────▼────────────────────┐
    │         VPS RISK AGENT (fail-closed)     │
    │  • 3+ consecutive losses → 1h cooldown  │
    │  • 24h loss > 5% equity → VETO          │
    │  • LLM error → default VETO             │
    └────────────────────┬────────────────────┘
                         │ PASS
    ┌────────────────────▼────────────────────┐
    │         TRADING MUTEX                    │
    │  Prevents analyst + scanner racing      │
    └────────────────────┬────────────────────┘
                         │
    ┌────────────────────▼────────────────────┐
    │         POSITION CHECK                   │
    │  No duplicate same-direction positions  │
    └────────────────────┬────────────────────┘
                         │
    ┌────────────────────▼────────────────────┐
    │         PRE-TRADE HOOKS (Next.js)       │
    │  amount-limit → balance-guard →         │
    │  cooldown → session-budget              │
    │  SL:TP >= 1:2 enforced                  │
    └────────────────────┬────────────────────┘
                         │
                    EXECUTE TRADE
                         │
    ┌────────────────────▼────────────────────┐
    │         POST-TRADE HOOKS                │
    │  cooldown-record → execution-monitor → │
    │  failure-logger → audit-trail           │
    └─────────────────────────────────────────┘
```

---

## Data Flow: Complete Signal-to-Trade Pipeline

```
Every 15 minutes:
┌────────────┐
│ Crucix 27  │──┐
│ OpenNews   │  │  collectAndAnalyze()
│ OKX WS    │──┤
└────────────┘  │
                ▼
        ┌───────────────┐     ┌───────────────┐
        │ Analyst Agent │     │ Analyst Agent  │
        │ (crypto mode) │     │ (stock mode)   │
        │ Tools: 6      │     │ Tools: 6       │
        └───────┬───────┘     └───────┬────────┘
                │                     │
         push_worthy?           push_worthy?
           │    │                  │
          YES   NO                YES → (future: stock execution)
           │
    ┌──────▼──────┐
    │ Risk Agent  │──── VETO → logged, skip
    └──────┬──────┘
           │ PASS
     ┌─────┼─────────────────┐
     ▼                       ▼
┌──────────┐         ┌──────────────┐
│BitgetExec│         │On-chain Exec │
│(CEX 主力) │         │(Coordinator) │
│ETH futures│         │session_swap  │
└──────────┘         └──────────────┘

Meanwhile (parallel):
┌──────────────────────────────┐
│ Scanner (每15分钟)            │
│ 540+ pairs → 35 candidates  │
│ → Top 10 + tech indicators  │
│ → LLM picks 1 best          │
│ → Auto-cancel stale orders  │
│ → Place limit + TP/SL       │
└──────────────────────────────┘

Every 3 hours:
┌──────────────────┐
│ Patrol Report    │
│ Reviewer Agent   │
└──────────────────┘

Every week:
┌──────────────────┐
│ Weekly Review    │
│ Strategy adjust  │
│ Lesson update    │
└──────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI-compatible (Claude, GPT-5.4, Ollama) |
| Agent Framework | VPS: 7 agents + tool-calling loop / Next.js: 3-stage coordinator |
| Trade Safety | Risk Agent (fail-closed) + Hook system + Trading mutex |
| Blockchain | Base (8453) + Reactive Network (1597) |
| CEX | Bitget (spot + futures, 540+ pairs) |
| Cross-chain | LiFi SDK (Base/ETH/BSC, 60+ chains) |
| Real-time | OKX WebSocket (BTC/ETH/SOL) + SSE push |
| Intelligence | Crucix 27-source OSINT + OpenNews 6551.io + Technical indicators |
| Database | SQLite (VPS: 11 tables) + JSON file store (Next.js: orders, tasks) |
| Risk Management | 5% daily loss limit + 3-loss cooldown + position dedup + SL:TP 1:2 |

---

## File Structure

```
RIFI/
├── src/                              # Smart Contracts (Solidity)
│   ├── StopOrderCallback.sol         # Base/BSC callback (chain-agnostic)
│   ├── PairOrderManager.sol          # Reactive event monitor
│   ├── OrderRegistry.sol             # Order ledger + OCO
│   └── SessionManagerV2.sol          # Session key + executeCall + whitelist
│
├── script/
│   ├── DeployBaseStopOrder.s.sol     # Base deployment (3-step)
│   ├── DeployArbitrumStopOrder.s.sol # Arbitrum deployment
│   └── DeploySessionManagerV2.s.sol  # SessionManager V2
│
├── vps-api-index.mjs                # VPS daemon (3100 lines, 7 agents)
│
├── web/                              # Next.js frontend + API
│   └── src/
│       ├── app/api/ (14 routes)
│       ├── lib/agents/ (coordinator)
│       ├── lib/hooks/ (trade safety)
│       ├── lib/tasks/ (persistence)
│       ├── lib/llm/ (18 tools)
│       ├── lib/chain/ (on-chain ops)
│       ├── lib/sse/ (push service)
│       └── lib/memory/ (7-section)
│
├── data/                             # Persistent state (gitignored)
├── docs/                             # ROADMAP, TODO
└── foundry.toml                      # Forge config
```
