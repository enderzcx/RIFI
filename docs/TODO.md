# RIFI TODO

> Last updated: 2026-03-31

## ✅ V3 Completed (2026-03-31)

- [x] Hook System: 4 pre-trade + 4 post-trade hooks with configurable risk-config
- [x] Multi-Agent Coordinator: Analyst → Strategist → Executor pipeline
- [x] Per-agent restricted tool sets (Analyst can't trade, Strategist can't trade)
- [x] Task System: JsonStore persistence, task lifecycle management
- [x] Event-indexer persistence: orders.json (survives restart)
- [x] /api/tasks endpoint: GET/POST/PATCH
- [x] Enhanced Memory: 7 sections with auto-decay (market_regime 3d, strategy_feedback 30d)
- [x] auto-trade/route.ts rewritten to use Coordinator
- [x] executor.ts integrated with pre/post hooks

## 🔴 High Priority (Next Session)

### V3 Integration Testing
- [ ] End-to-end test: VPS signal → Coordinator → session_swap → SSE broadcast
- [ ] Test hook blocking: trigger amount-limit, cooldown, balance-guard
- [ ] Test order persistence: restart server, verify orders.json restored
- [ ] Test memory decay: create market_regime entry, verify 3-day expiry

### BSC Chain Expansion
- [ ] Deploy SessionManagerV2 on BSC
- [ ] Deploy Reactive StopOrderCallback on BSC (for GM tokens)
- [ ] Test LiFi route: Base USDC → BSC NVDAon
- [ ] Transfer BNB to deployer wallet

### Bitget Trading
- [ ] Expand scanner: more pairs, 4H candles for better MA signals
- [ ] Add Bitget algo orders (OCO, trailing stop) to Executor tools
- [ ] Position management tool (close partial, adjust leverage)

## 🟡 Medium Priority

### Coordinator Enhancements
- [ ] Add Coordinator mode to /api/chat (not just auto-trade)
- [ ] Configurable agent models (analyst=opus, strategist=sonnet, executor=haiku)
- [ ] Scratchpad persistence: save coordinator runs to tasks.json for replay
- [ ] Analyst: parallel tool calls (get_price + get_portfolio + get_signals)

### Hook Enhancements
- [ ] Volatility gate hook: pause trading if 5min price move > 3%
- [ ] Gas price hook: block if Base gas > 50 gwei
- [ ] Daily loss limit hook: stop trading if cumulative daily loss > X%
- [ ] Hook dashboard: show recent hook events in frontend

### Tokenized US Stocks
- [ ] Research PancakeSwap liquidity for AAPLon/NVDAon/TSLAon/SPYon
- [ ] Add Ondo mint/redeem as alternative to DEX swap
- [ ] Stock Analyst Agent: enhanced prompt for equity-specific analysis
- [ ] Chainlink price feed integration for GM tokens

### Dashboard
- [ ] Task status display (running coordinators, active monitors)
- [ ] Hook event log viewer
- [ ] Agent decision trace viewer (Analyst → Strategist → Executor)
- [ ] LiFi cross-chain trade history
- [ ] Bitget positions + PnL

## 🟢 Low Priority / Future

### V4: SQLite Migration
- [ ] Replace JsonStore with better-sqlite3 for orders + tasks
- [ ] Trade history aggregation queries (win rate, sharpe, drawdown)
- [ ] Memory search: semantic similarity for relevant memory retrieval

### OKX Integration (deferred)
- [ ] Fix OKX API key
- [ ] OKX MCP server as alternative CEX channel

### Multi-Chain Reactive
- [ ] Reactive callback contracts on BSC, Arbitrum, Ethereum
- [ ] Cross-chain SL/TP management UI
- [ ] Unified order registry across chains

### Advanced Learning
- [ ] Strategy Competition: paper-trade multiple strategies, rank weekly
- [ ] Prompt A/B testing
- [ ] Full backtesting replay engine

### Infrastructure
- [ ] Verify SessionManagerV2 on BaseScan
- [ ] Rate limiting on VPS API
- [ ] Grafana dashboard for agent metrics
- [ ] Automated VPS deployment

## ✅ V2 Completed (2026-03-31)

- [x] V2 Roadmap Phase 1-5 (all done)
- [x] Multi-Agent (VPS): Analyst/Risk/Strategist/Executor/Reviewer
- [x] Per-agent model allocation
- [x] Learning Loop: candles → scoring → lessons → prompt injection
- [x] Observability: agent metrics + Telegram alerting
- [x] SessionManagerV2 deployed (Base) with executeCall + whitelist
- [x] LiFi SDK integrated, LiFi Diamond whitelisted
- [x] Bitget CEX integration (spot + futures)
- [x] Market scanner: 540 pairs, tech indicators, auto limit orders
- [x] First Bitget futures trade executed
