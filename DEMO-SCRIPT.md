# RIFI Demo Script (5 min)

## Pre-Recording Setup

1. Wallet on Base with: ~0.005 ETH (gas) + ~5 USDC + small WETH (optional)
2. Clear browser localStorage (avoid stale messages)
3. MetaMask on Base network
4. OBS or Win+G recording at 1920x1080

---

## Scene 1: Landing Page (20s)

- Open `https://enderzcxai.duckdns.org`
- Pause 3s on hero animation
- Click **Launch App**

## Scene 2: Connect Wallet (30s)

- Click Connect Wallet → MetaMask
- Right panel shows YOUR wallet's balance (multi-wallet support)
- Point out: Market Intelligence (risk/sentiment), Sentinel Mode

## Scene 3: AI Chat — Query (40s)

- Type: `ETH 现在多少钱`
- Watch: tool card streams in (get_price loading → done ✓)
- AI responds in Chinese with price analysis

- Type: `帮我分析一下市场`
- Watch: multiple tools fire (get_price → get_market_signals → get_portfolio)
- AI gives market recommendation with confidence score

## Scene 4: Enable Auto Trading (40s)

- Click **Enable Auto Trading** in right panel
- MetaMask pops up 4 signatures:
  1. `createSession` — grant AI trading rights (0.02 ETH budget, 24h)
  2. `approve WETH to Callback` — for stop-loss execution
  3. `approve WETH to Router` — for swaps
  4. `approve USDC to Router` — for swaps
- Session Key shows: **Active | 0.02 ETH | Expires [time]**

## Scene 5: AI Trade — Fully Automatic (60s)

- Type: `买 2 USDC 的 ETH`
- AI detects active Session → executes WITHOUT user signature
- Tool cards: get_price ✓ → get_portfolio ✓ → market_swap ✓ (with TX link)
- Click TX link → BaseScan shows real on-chain transaction

**Key line:** "The AI executed this trade on-chain without any user signature. The SessionManager contract enforces the budget — AI cannot exceed it."

## Scene 6: Set Stop-Loss — Fully Automatic (40s)

- Type: `给刚买的 ETH 设个止损在 1800`
- AI deploys Reactive contract (no signature needed — Session active)
- Tool card: set_stop_loss ✓ (with Reactive Network TX link)

**Key line:** "This stop-loss contract is now running on Reactive Network. Even if I close this browser, shut down the server — when ETH drops to $1800, it automatically sells. No backend required."

## Scene 7: Sentinel Mode (20s)

- Click **Switch to Aggressive** in right panel
- Show description change: "PRIORITY+ signals, confidence > 50"

**Key line:** "In Aggressive mode, the AI scans 27+ data sources every 15 minutes and trades autonomously within the on-chain budget."

## Scene 8: Summary (30s)

Point at each component:
- **Session Key** — on-chain budget constraint for AI
- **Reactive Contracts** — decentralized stop-loss, no backend
- **27+ data sources** — FRED, GDELT, crypto news, Twitter sentiment
- **Two modes** — Conservative (FLASH only) / Aggressive (PRIORITY+)

**Closing:** "RIFI — AI decides. Reactive executes."

---

## Project Description

**RIFI — Reactive Intelligence for Financial Instruments**

AI-native autonomous trading agent on Base. The AI aggregates 27+ real-time data sources (macro economics, geopolitics, crypto news, social sentiment), makes trading decisions with confidence scoring, and executes on-chain via Uniswap V2. Stop-loss and take-profit orders run on Reactive Smart Contracts — fully decentralized, no backend required. Users control AI autonomy through on-chain Session Keys with per-trade limits, total budgets, and time-based expiry.

**Why Reactive Network:**
Traditional DEX stop-loss requires a centralized keeper to monitor prices. If the server goes down, orders don't execute. Reactive Smart Contracts subscribe to Uniswap Sync events across chains and autonomously trigger callbacks when price conditions are met — eliminating the single point of failure.

**Key Features:**
- Sentinel Mode: 24/7 autonomous trading with Conservative/Aggressive modes
- Session Key: On-chain budget enforcement (SessionManager contract)
- Reactive Stop-Loss/Take-Profit: Decentralized, runs forever without backend
- Multi-wallet support: Any wallet can connect, trade, and set orders
- Real-time streaming: Tool execution visible step-by-step in chat
