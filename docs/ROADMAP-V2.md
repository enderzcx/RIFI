# RIFI V2 Roadmap — 大厂级单人交易智能体

> 目标：以 OKX JD (Principal AI Engineer, AI Agent Development) 为标尺，将 RIFI 从"能跑的 trading bot"升级为"大厂级 autonomous trading agent system"
> 用户：0xEnder，单人使用
> 日期：2026-03-31
>
> 参考项目：
> - [OKX Agent Trade Kit](https://github.com/okx/agent-trade-kit) — MCP server, 107 tools, algo orders
> - [NOFX](https://github.com/NoFxAiOS/nofx) — 多交易所自主交易平台, Strategy Studio, AI 竞赛模式
> - [Daily Stock Analysis](https://github.com/ZhuLinsen/daily_stock_analysis) — 决策看板, 多维分析, backtesting, 情绪分析

---

## 当前状态 (V1)

- 单 agent，LLM + 14 tools
- 链上执行：Base + Uniswap V2，WETH/USDC 单交易对
- 感知：27 源 Crucix + OpenNews，15min 轮询
- 决策：LLM prompt 驱动，每轮独立，无目标追踪
- 风控：session key 预算上限，无独立风控 agent
- 学习：无，agent 不从历史结果中学习
- 存储：SQLite (news/analysis/patrol_reports)，刚加
- 模式：crypto + stock 双模式分析

## 核心差距 (对标 OKX JD)

1. **无 learning loop** — agent 不知道自己历史决策对不对
2. **无 multi-agent** — 单体 agent 做所有事，决策/风控/执行耦合
3. **无 goal planning** — 每轮独立决策，不串联成持续策略
4. **感知太慢** — 15min 轮询，无法秒级响应价格异动
5. **执行层单一** — 只有链上 DEX，品种/深度/工具受限

---

## 架构设计 (V2)

```
┌─────────────────────────────────────────────────────┐
│                    Strategist Agent                   │
│  目标管理 / 策略规划 / 子目标分解 / 跨轮次状态追踪      │
└──────────────────────┬──────────────────────────────┘
                       │ goals + context
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌──────────┐ ┌───────────────────────┐
   │  Analyst   │ │   Risk   │ │      Executor         │
   │  Agent     │ │  Agent   │ │                       │
   │            │ │          │ │  ┌─────────────────┐  │
   │ - Crucix   │ │ - 仓位检查│ │  │  OKX MCP (主力)  │  │
   │ - News     │ │ - 连续亏损│ │  │  107 tools       │  │
   │ - 价格流   │ │ - 单日限额│ │  │  现货/合约/期权   │  │
   │ - 技术指标 │ │ - 否决权  │ │  │  algo orders     │  │
   │            │ │          │ │  ├─────────────────┤  │
   │ 输出:      │ │ 输出:    │ │  │  On-chain (备用)  │  │
   │ 结构化信号 │ │ PASS/VETO│ │  │  Base + Uniswap  │  │
   │            │ │          │ │  │  Session Key     │  │
   └────────────┘ └──────────┘ │  │  Reactive SL/TP  │  │
                               │  └─────────────────┘  │
                               └───────────────────────┘
                                          │
                               ┌──────────▼──────────┐
                               │    Reviewer Agent    │
                               │  PnL 追踪 / 回测     │
                               │  策略评分 / 周报生成   │
                               └─────────────────────┘
```

### Agent 职责定义

| Agent | 输入 | 输出 | 运行频率 |
|-------|------|------|---------|
| **Strategist** | 用户目标 + Analyst 信号 + Reviewer 反馈 | 交易计划（目标/子目标/约束） | 用户触发 + 每日自动复盘 |
| **Analyst** | Crucix + News + 价格流 + OKX 技术指标 + 社交情绪 | 结构化信号 JSON + 决策看板 | 15min 常规 + 秒级异动 |
| **Risk** | Executor 的交易请求 + 账户状态 | PASS / VETO + 原因 | 每次交易前 |
| **Executor** | Strategist 的计划 + Risk 的 PASS | 链上/OKX 交易执行 | 事件驱动 |
| **Reviewer** | 交易记录 + 价格历史 + 决策日志 | PnL 报告 / 策略评分 / 周报 | 每笔交易后 + 每周 |

---

## 实施计划

### Phase 1：数据闭环 — "能衡量才能优化" ✅ DONE

> 预计工作量：中等
> 依赖：SQLite (已完成)
> **状态：已完成 (2026-03)**

#### 1.1 PnL Tracker

新建 SQLite 表 `trades`：

```sql
CREATE TABLE trades (
  id INTEGER PRIMARY KEY,
  trade_id TEXT UNIQUE,          -- 唯一标识
  source TEXT DEFAULT 'onchain', -- 'okx' | 'onchain'
  pair TEXT,                     -- 'WETH/USDC', 'BTC-USDT-SWAP' 等
  side TEXT,                     -- 'buy' | 'sell'
  entry_price REAL,
  exit_price REAL,               -- 平仓时填入
  amount REAL,
  pnl REAL,                      -- 平仓时计算
  pnl_pct REAL,
  fee REAL,
  status TEXT DEFAULT 'open',    -- 'open' | 'closed' | 'stopped'
  opened_at TEXT,
  closed_at TEXT,
  signal_snapshot TEXT,          -- 开仓时的 analysis JSON
  decision_reasoning TEXT        -- AI 的推理过程
);
```

关键指标自动计算：
- Win rate = closed trades with pnl > 0 / total closed
- Total PnL (USDT)
- Max drawdown
- Sharpe ratio (需价格历史)
- Average hold duration

#### 1.2 Decision Ledger

新建 SQLite 表 `decisions`：

```sql
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  timestamp TEXT,
  agent TEXT,                    -- 'analyst' | 'strategist' | 'risk' | 'executor'
  action TEXT,                   -- 'analyze' | 'plan' | 'approve' | 'veto' | 'execute' | 'hold'
  input_summary TEXT,            -- 输入数据摘要
  output_summary TEXT,           -- 输出摘要
  reasoning TEXT,                -- AI 推理过程
  confidence INTEGER,
  result TEXT,                   -- 事后填入：'correct' | 'wrong' | 'pending'
  trade_id TEXT                  -- 关联 trades 表
);
```

#### 1.3 Dashboard 指标

前端 dashboard 新增：
- 累计收益曲线 (PnL over time)
- 胜率 / 盈亏比
- 最近 20 笔交易列表
- 当前持仓状态

---

### Phase 2：感知升级 — "从 15min 盲人到秒级反应" ✅ DONE

> 预计工作量：中等
> 可与 Phase 1 并行
> **状态：已完成 (2026-03)**

#### 2.1 价格流 WebSocket

```
数据源选择：
- OKX WebSocket API (wss://ws.okx.com:8443/ws/v5/public)
  - 订阅：tickers, mark-price, index-tickers
  - 品种：BTC-USDT, ETH-USDT, SOL-USDT + 主要合约
- 链上价格保留 Uniswap getAmountsOut 作为校验
```

#### 2.2 事件驱动触发

```
价格异动规则：
- 5min 内价格变动 > 2% → 触发 Analyst 即时分析
- 5min 内价格变动 > 5% → 触发 FLASH 级分析 + 通知用户
- VIX 突破 25 → 触发宏观风险重评估
```

#### 2.3 三层感知

| 层级 | 频率 | 触发方式 | 内容 |
|------|------|---------|------|
| 实时 | 秒级 | 价格流异动 | 快速信号评估，是否需要行动 |
| 常规 | 15min | 定时 | 完整 27 源分析 (现有逻辑) |
| 巡逻 | 3h | 定时 | 周期报告 (现有 patrol) |

---

### Phase 3：Multi-Agent 拆分 — "从单体到协作" ✅ DONE

> 预计工作量：大
> 依赖 Phase 1 的 decision ledger
> **状态：已完成 (2026-03-31)**

#### 3.1 Agent 通信协议

```javascript
// Agent 间消息格式
{
  from: 'analyst',
  to: 'strategist',
  type: 'SIGNAL_UPDATE',
  payload: { /* 结构化信号 */ },
  timestamp: '2026-03-31T12:00:00Z',
  trace_id: 'uuid'  // 全链路追踪
}
```

Agent 编排方式：
- VPS 进程内多 agent（不拆微服务，单人用不需要）
- 参考 NOFX 的 MCP client layer 设计：每个 agent 有独立 MCP tool set
- 共享 SQLite + 内存消息队列
- 每个 agent 有独立 system prompt + tool set

#### 3.2 Analyst Agent — 多维分析（参考 Daily Stock Analysis）

当前 Analyst 只有宏观新闻 + Crucix 数据。升级为多维分析：

```
分析维度（5 层，每层独立评分后综合）：

1. 宏观面 (权重 20%)
   - VIX、S&P500、黄金、原油、地缘冲突
   - 数据源：Crucix

2. 技术面 (权重 30%)
   - OKX 70+ 技术指标：MA/EMA/RSI/MACD/Bollinger/ATR
   - 支撑位/压力位识别
   - 数据源：OKX MCP market tools

3. 新闻面 (权重 20%)
   - AI 评分新闻 + 方向信号
   - 数据源：OpenNews (6551.io)

4. 社交情绪面 (权重 15%)
   - Reddit (r/cryptocurrency, r/wallstreetbets)
   - X/Twitter crypto KOL 情绪
   - 数据源：待接入（Stock Sentiment API / SerpAPI）

5. 链上面 (权重 15%)
   - 巨鲸动向、DEX 交易量、资金流向
   - 数据源：OnchainOS (已有)

输出：每维度 0-100 评分 + 综合加权评分 + 决策看板
```

#### 3.3 Strategist Agent

核心能力：
- 接收用户自然语言目标："本周在 ETH $1800-1900 区间分批建仓 0.5 ETH"
- 拆解为子目标：[限价买入 0.1 ETH @ $1820, 0.1 @ $1850, ...]
- 持续追踪：子目标完成度、市场条件变化时调整计划
- 状态持久化到 SQLite `strategies` 表

**决策看板输出格式（参考 Daily Stock Analysis）：**
```
[ETH/USDC] 评分: 72/100 | 方向: 看多
一句话结论: VIX 回落 + 链上巨鲸增持，短期偏多但需注意 $1920 压力位
买入点: $1820-1850 分批 | 止损: $1780 | 目标: $1950
行动清单:
  [ ] 确认 VIX < 20 维持
  [ ] 确认 BTC 未破 $60k 支撑
  [x] 链上情绪偏多
风险提示: 若 S&P500 跌破 5200，暂停建仓计划
```

**策略模板（参考 NOFX Strategy Studio）：**

预置策略模板，用户可选择或自然语言自定义：
- 网格交易：指定区间 + 网格数 + 单格金额
- 均线突破：MA 交叉信号触发
- 趋势跟踪：ATR 通道 + 动态止损
- 事件驱动：VIX 阈值 / 新闻事件触发
- 定投策略：固定时间 + 固定金额

```sql
CREATE TABLE strategies (
  id INTEGER PRIMARY KEY,
  goal TEXT,                     -- 用户原始目标
  template TEXT,                 -- 'grid' | 'ma_cross' | 'trend' | 'event' | 'dca' | 'custom'
  plan_json TEXT,                -- 拆解后的子目标列表
  params_json TEXT,              -- 策略参数 (区间/均线周期/ATR倍数等)
  status TEXT DEFAULT 'active',  -- 'active' | 'completed' | 'cancelled' | 'paused'
  progress_pct REAL DEFAULT 0,
  score INTEGER,                 -- 策略评分 0-100
  created_at TEXT,
  updated_at TEXT
);
```

#### 3.4 Risk Agent

独立风控规则（不可被其他 agent 绕过）：

```
硬规则（自动否决）：
- 单笔交易 > 账户净值 10%
- 24h 累计亏损 > 5%
- 连续 3 笔亏损后冷却 1h
- 账户余额 < 安全阈值

软规则（警告但不否决）：
- Analyst confidence < 60
- 与 Strategist 当前目标方向相反
- 同一品种 1h 内重复交易
```

#### 3.5 Executor Agent — 双通道

```
OKX 通道 (主力):
  - 通过 okx-trade-mcp 执行
  - 支持：现货 / 合约 / 期权 / algo orders / 网格 bot
  - 优势：深度好、品种多、手续费低

链上通道 (备用):
  - 通过现有 RIFI session key + Uniswap 执行
  - 支持：WETH/USDC swap + Reactive SL/TP
  - 触发条件：OKX 不可用 / 用户指定链上执行 / 去中心化场景
```

OKX MCP 集成步骤：
1. `npm install -g @okx_ai/okx-trade-mcp`
2. 配置 OKX API key（本地存储）
3. Executor agent 的 tool set 注册 OKX MCP 的 107 tools
4. 路由逻辑：默认 OKX，fallback 链上

---

### Phase 4：Learning Loop — "从固定策略到自我进化" ✅ DONE

> 预计工作量：大
> 依赖 Phase 1 (PnL + Decision Ledger) + Phase 3 (multi-agent)
> 参考：Daily Stock Analysis 的 backtesting + NOFX 的 AI Competition Mode
> **状态：已完成 (2026-03-31)**

#### 4.1 Backtesting Engine（参考 Daily Stock Analysis）

```
输入：analysis 历史表 + 价格历史
逻辑：
  - 回放过去 N 天的 analysis 记录
  - 模拟按 recommended_action 执行交易
  - 计算假设 PnL vs 实际 PnL
输出：策略准确率、最优参数

验证机制（参考 Daily Stock Analysis）：
  - 每条历史 briefing 事后标注"预测是否正确"
  - 统计 AI 在不同市场状态下的预测准确率
  - 生成 bias threshold alerts：当 AI 连续偏多/偏空时发出校正警告
```

#### 4.2 Signal Source Scoring

```
每个信号源追踪准确率：
- Crucix VIX 信号 → 30 天准确率 72%，权重 1.2x
- OpenNews sentiment → 30 天准确率 58%，权重 0.8x
- 技术指标 RSI → 30 天准确率 65%，权重 1.0x
- 社交情绪 (Reddit/X) → 30 天准确率 52%，权重 0.6x

低分信号自动降权，高分信号加权

趋势确认规则（参考 Daily Stock Analysis）：
- 单一信号不足以触发交易，需 2+ 信号源共振
- 技术面 + 情绪面 + 宏观面至少 2/3 对齐才执行
```

#### 4.3 Strategy Competition（参考 NOFX AI Competition Mode）

```
多策略同时跑 paper trading，比较真实胜率：
- 策略 A：纯技术面（MA 交叉 + RSI + ATR）
- 策略 B：纯情绪面（新闻 + 社交情绪 + VIX）
- 策略 C：混合策略（当前 RIFI 的 LLM 综合分析）
- 策略 D：用户自定义

每周排名，真实资金跟随表现最好的策略
淘汰连续 4 周末位的策略，引入新策略替代
```

#### 4.4 Prompt Evolution

```
每周自动：
1. 统计各类信号的胜率
2. 生成 "本周学到的教训" 列表
3. 注入 Analyst agent 的 system prompt
4. 下周分析时自动带上历史教训

例如：
"过去 7 天发现：VIX > 20 时做空 ETH 胜率 78%，
 但 VIX > 30 时反而是抄底机会（3/3 次反弹）。
 调整：VIX 20-30 偏空，VIX > 30 关注反转信号。"
```

#### 4.5 Weekly Self-Review

Reviewer agent 每周日自动生成：
- 本周 PnL 总结
- 最佳/最差交易分析
- 信号源准确率排名
- 策略竞赛排名
- 策略调整建议
- 推送到 Telegram

---

### Phase 5：Observability — "全链路可追溯" ✅ DONE

> 预计工作量：中等
> 可随时插入，建议 Phase 3 同步开始
> **状态：已完成 (2026-03-31)**

#### 5.1 OpenTelemetry Tracing

复用 Kite Trace 的 OTel 设计：

```
每个决策链路一条 trace：
Analyst.analyze (span)
  → Strategist.evaluate (span)
    → Risk.check (span)
      → Executor.execute (span)
        → OKX.placeOrder / Onchain.swap (span)

每个 span 记录：输入、输出、耗时、token 用量
```

#### 5.2 Alerting

```
异常检测规则：
- 连续 N 笔亏损 → Telegram 警报
- 账户余额低于阈值 → Telegram 警报
- Agent 超过 30min 无心跳 → Telegram 警报
- 单笔亏损超过账户 3% → 立即通知 + 暂停交易
```

---

## 技术栈变更

| 组件 | V1 | V2 |
|------|-----|-----|
| 执行层 | Uniswap V2 on Base | **OKX MCP (主力)** + Uniswap (备用) |
| Agent 架构 | 单 LLM + tools | **Multi-agent (4+1)** |
| 价格数据 | Crucix 15min 批量 | **OKX WebSocket 秒级** + Crucix 宏观 |
| 技术指标 | 无 | **OKX 70+ 内置指标** |
| 社交情绪 | TG urgent only | **Reddit + X + TG 多源情绪** (参考 Daily Stock Analysis) |
| 分析维度 | 宏观+新闻 (2层) | **宏观+技术+新闻+情绪+链上 (5层)** |
| 学习能力 | 无 | **Backtesting + Signal Scoring + Prompt Evolution** |
| 存储 | SQLite (news/analysis/patrol) | SQLite + **trades/decisions/strategies** |
| 追踪 | console.log | **OpenTelemetry** |
| 交易品种 | WETH/USDC | **BTC/ETH/SOL 现货 + 合约 + 期权** |

---

## 实施优先级

```
Phase 1 ██████████ 数据闭环 (PnL + Decision Ledger + Dashboard)     ✅ DONE
Phase 2 ██████████ 感知升级 (OKX WebSocket + 事件驱动)               ✅ DONE
Phase 3 ██████████ Multi-Agent (Strategist/Analyst/Risk/Executor/Reviewer) ✅ DONE
Phase 4 ██████████ Learning Loop (Backtest + Scoring + Evolution)    ✅ DONE
Phase 5 ██████████ Observability (Metrics + Alerting)               ✅ DONE

依赖关系：
Phase 1 ✅ ──→ Phase 3 ✅ ──→ Phase 4 ✅
Phase 2 ✅ (已完成)
Phase 5 ✅ (已完成)
```

---

## 成功标准

完成 V2 后，RIFI 应该能：

- [x] 接收自然语言目标，自动拆解并执行多步交易策略
- [x] 在 CEX (Bitget) 执行现货/合约交易，链上作为备用通道
- [x] 秒级响应价格异动，而不是等 15 分钟
- [x] 独立风控 agent 审核每笔交易，不可绕过
- [x] 每笔交易有完整的 PnL 记录和决策链路追踪
- [x] 每周自动复盘，根据历史结果调整策略
- [x] 信号源自动评分，低分降权高分加权
- [x] 全链路 tracing (trace_id + agent metrics)，每个决策可回溯

**对标 OKX JD 的覆盖度：autonomous agent ✓ / multi-agent ✓ / real-time ✓ / learning ✓ / goal-directed ✓**

---

## V3 Extensions (2026-03-31)

> 基于 Claude Code 源码架构模式，新增 Next.js 端的安全层和多 Agent 协调

### V3.1: Hook System (`lib/hooks/`) ✅
- 4 pre-trade hooks: 金额上限、余额保护、交易冷却、Session 预算告警
- 4 post-trade hooks: 冷却计时、执行耗时监控、失败日志、审计链
- `risk-config.ts` 集中配置阈值
- 集成到 `executor.ts` 的所有写操作

### V3.2: Multi-Agent Coordinator (`lib/agents/`) ✅
- Analyst → Strategist → Executor 三阶段流水线
- 每个 Agent 受限 tool 集（权限最小化）
- 双重 gate: confidence < 50 不执行 + direction=hold 不执行
- `auto-trade/route.ts` 重写为 Coordinator 模式

### V3.3: Task System + Persistence (`lib/tasks/`) ✅
- `JsonStore<T>` 通用 JSON 文件持久化（零外部依赖）
- `event-indexer.ts` 订单持久化到 `orders.json`（重启不丢失）
- Task manager: create/start/complete/fail/cancel + prune
- `/api/tasks` endpoint

### V3.4: Enhanced Memory (`lib/memory/`) ✅
- 新增 4 类记忆: market_regime(3d) / strategy_feedback(30d) / risk_lesson(永久) / reference
- 自动日期标记 + 衰减过滤
- `update_memory` tool 支持全部 7 个 section
