# RIFI Architecture — V2

> Last updated: 2026-03-31

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VPS (vps-api-index.mjs)                     │
│                                                                     │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  ┌───────────────┐   │
│  │  Analyst   │  │ Strategist│  │    Risk     │  │   Reviewer    │   │
│  │ gpt-5.4-  │  │ gpt-5.4-  │  │ gpt-5.4-   │  │  gpt-5.4-    │   │
│  │ mini      │  │ mini      │  │ mini        │  │  mini         │   │
│  │           │  │           │  │             │  │               │   │
│  │ Crucix 27 │  │ Strategies│  │ Hard rules  │  │ Signal scores │   │
│  │ News API  │  │ Goal mgmt │  │ + LLM soft  │  │ Lessons       │   │
│  │ OKX WS    │  │ Templates │  │ PASS/VETO   │  │ Weekly review │   │
│  │ Bitget    │  │           │  │             │  │ Telegram push │   │
│  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘  └───────┬───────┘   │
│        │              │               │                  │           │
│        ▼              ▼               ▼                  ▼           │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    Executor Agent                            │     │
│  │                 gpt-5.4-mini-low-fast                       │     │
│  │                                                             │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │     │
│  │  │ Bitget CEX   │  │ LiFi SDK     │  │ On-chain (Base)  │  │     │
│  │  │ (Primary)    │  │ (Cross-chain)│  │ (Backup)         │  │     │
│  │  │              │  │              │  │                  │  │     │
│  │  │ Spot/Futures │  │ 60+ chains   │  │ SessionMgrV2     │  │     │
│  │  │ 540 pairs    │  │ Any token    │  │ Uniswap V2       │  │     │
│  │  │ Algo orders  │  │ Ondo stocks  │  │ Reactive SL/TP   │  │     │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    Market Scanner                            │     │
│  │  Every 15min: scan 540 Bitget futures pairs                 │     │
│  │  Filter: vol > $5M + move > 2% → top 10                    │     │
│  │  Tech indicators: RSI / MA20 / MA50 / Bollinger / S&R      │     │
│  │  → AI evaluates → limit orders at key levels               │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    Learning Loop                             │     │
│  │  5min candles → Signal annotation (4h lag) → Lessons        │     │
│  │  Lessons → inject into Analyst prompt → better signals      │     │
│  │  Source scoring → weight adjustment → accuracy tracking     │     │
│  │  Weekly self-review → Telegram report                       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌──────────────────────────┐  ┌────────────────────────────┐       │
│  │ SQLite (data/rifi.db)    │  │ Express API (:3200)        │       │
│  │                          │  │                            │       │
│  │ news / analysis          │  │ /api/signals               │       │
│  │ trades / decisions       │  │ /api/bitget/*              │       │
│  │ strategies               │  │ /api/lifi-*                │       │
│  │ candles / signal_scores  │  │ /api/strategies            │       │
│  │ lessons / source_scores  │  │ /api/observability         │       │
│  │ agent_messages           │  │ /api/signal-accuracy       │       │
│  │ patrol_reports           │  │ /api/candles               │       │
│  └──────────────────────────┘  └────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (rifi-web)                       │
│                                                                     │
│  Dashboard: Portfolio / Signals / PnL / Decisions / Trade History   │
│  Chat: Interactive agent with all 17 tools                         │
│  SSE: Real-time push (signals, trades, patrol reports)             │
│  SessionManager UI: Create/revoke sessions                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Fundamental Analysis (every 15min + price anomaly)

```
Crucix (27 sources) + OpenNews + OKX WebSocket prices
  → Analyst Agent (tool-calling: get_crucix, get_news, get_prices)
  → Structured signal JSON (risk, sentiment, bias, action, confidence)
  → if push_worthy:
      → Strategist Agent (evaluate active strategies)
      → Risk Agent (PASS / VETO)
      → if PASS: Executor (Bitget + on-chain)
  → Signal annotation (score after 4h against actual price)
  → Reviewer (every 3h: lessons / every 7d: weekly report)
```

### 2. Technical Analysis (every 15min)

```
Bitget 540 futures tickers → filter (vol + move)
  → top 10 candidates → fetch 1H candles
  → RSI / MA / Bollinger / Support & Resistance
  → AI Executor evaluates → limit orders at key levels
```

### 3. Learning Feedback Loop

```
Signal → 4h later: was prediction correct? → signal_scores table
  → Reviewer reads accuracy stats → writes lessons
  → Analyst reads lessons in next prompt → improved signals
  → Source weight recalculation (monthly)
```

## Smart Contracts

| Contract | Chain | Address | Purpose |
|----------|-------|---------|---------|
| SessionManagerV2 | Base | `0x342168e8...f611` | Budget-constrained execution (Uniswap + LiFi whitelist) |
| LiFi Diamond | All | `0x1231DEB6...4EaE` | Cross-chain swap router (whitelisted on SMv2) |
| StopOrderCallback | Base | `0x9702220849...f3` | Reactive SL/TP callback |
| OrderRegistry | Base | `0xcE9720Ae...D698` | Track active SL/TP orders |

## Security Model

```
AI Agent → can ONLY execute through:
  1. SessionManagerV2.executeSwap() — Uniswap, budget-limited
  2. SessionManagerV2.executeCall() — LiFi, whitelist + budget-limited
  3. Bitget API — separate API key, no wallet access
  4. Risk Agent gate — hard rules (code) + soft rules (LLM)

AI NEVER touches private key directly.
Private key only used by server to sign SessionManager calls.
```

## External Dependencies

| Service | Purpose | Endpoint |
|---------|---------|----------|
| Crucix | 27-source OSINT macro data | `localhost:3117` |
| OpenNews | AI-scored crypto news | `ai.6551.io` |
| OKX WebSocket | Real-time BTC/ETH/SOL prices | `wss://ws.okx.com` |
| Bitget API | CEX trading (primary) | `api.bitget.com` |
| LiFi SDK | Cross-chain routing | `@lifi/sdk` |
| Reactive Network | On-chain SL/TP automation | `mainnet-rpc.rnk.dev` |
| LLM | Agent reasoning | `localhost:8080/v1` |

## Database Schema (12 tables)

| Table | Records | Purpose |
|-------|---------|---------|
| `news` | per fetch | AI-scored news with sentiment |
| `analysis` | every 15min | Full signal JSON per mode |
| `trades` | per trade | PnL tracking, signal snapshot |
| `decisions` | per agent action | Full audit trail with trace_id |
| `strategies` | user-created | Goal tracking, scoring |
| `candles` | every 5min | OHLCV price history |
| `signal_scores` | per analysis (4h lag) | Prediction accuracy |
| `lessons` | from Reviewer | Active lessons for Analyst prompt |
| `source_scores` | monthly | Signal source weight tracking |
| `patrol_reports` | every 3h | Period summaries |
| `agent_messages` | per message | Inter-agent communication log |
| `strategies` | user-created | Goal/template/params/score |

## Agent Tool Registry (17 tools)

| Tool | Used By | Channel |
|------|---------|---------|
| `get_market_signals` | Chat/Executor | VPS API |
| `get_price` | Chat/Executor | On-chain (Uniswap) |
| `get_portfolio` | Chat/Executor | On-chain |
| `get_active_orders` | Chat/Executor | On-chain |
| `get_session` | Chat/Executor | On-chain |
| `get_crypto_news` | Chat | VPS API |
| `get_crucix_data` | Chat | VPS API |
| `get_onchain_data` | Chat | VPS API |
| `market_swap` | Chat | On-chain (Uniswap) |
| `session_swap` | Executor | On-chain (SessionMgr) |
| `set_stop_loss` | Chat/Executor | Reactive Network |
| `set_take_profit` | Chat/Executor | Reactive Network |
| `cancel_order` | Chat | On-chain |
| `update_memory` | Chat | Filesystem |
| `lifi_swap` | Chat/Executor | LiFi SDK → cross-chain |
| `bitget_trade` | Chat/Executor | Bitget API |
| `bitget_account` | Chat/Executor | Bitget API |
| `manage_strategy` | Chat | VPS API |
