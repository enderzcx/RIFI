# RIFI 系统架构

> AI 决策，Reactive 执行。

---

## 链路一：用户对话下单

用户在聊天框输入指令，AI 理解后调用工具执行。

```
用户："买 2 USDC 的 ETH，止损设在 1800"
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  前端 ChatWindow                                             │
│  POST /api/chat (SSE 流)                                     │
│  body: { messages: [...], userAddress: "0xABC..." }         │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  服务端 /api/chat                                            │
│                                                              │
│  1. 注入 system prompt + 用户记忆                             │
│  2. 调用 LLM（流式），LLM 返回 tool_calls                     │
│  3. 对每个 tool_call：                                       │
│     → SSE 推送 tool_start（前端显示 loading 卡片）            │
│     → executeTool(工具名, 参数, 用户钱包地址)                  │
│     → SSE 推送 tool_end（前端更新为完成卡片）                  │
│  4. LLM 根据工具结果生成最终回复                               │
│     → SSE 逐 token 推送 content_delta                        │
│  5. SSE 推送 done                                            │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  executeTool 内部逻辑                                        │
│                                                              │
│  检查用户是否有活跃 Session Key                               │
│         │                                                    │
│    ┌────┴──────────────────┐                                 │
│    ▼                       ▼                                 │
│  有 Session              无 Session                          │
│  (canServerExecute)      (手动模式)                           │
│    │                       │                                 │
│    │  market_swap:         │  market_swap:                   │
│    │  → AI 直接调           │  → 返回 sign_request            │
│    │    Uniswap swap       │  → 前端弹 MetaMask 签名         │
│    │                       │                                 │
│    │  set_stop_loss:       │  set_stop_loss:                 │
│    │  → AI 代部署          │  → 返回 approve tx (Base)       │
│    │    Reactive 合约      │  → 返回 deploy tx (RNK 1597)    │
│    │    (client=用户地址)   │  → 前端依次弹 MetaMask 签名     │
│    │                       │                                 │
│    │  get_portfolio:       │  get_portfolio:                 │
│    │  → 读用户钱包余额     │  → 读用户钱包余额                │
│    │    (相同)              │    (相同)                       │
│    └────┬──────────────────┘                                 │
│         ▼                                                    │
│    链上交易 → TX hash 返回给 LLM → LLM 生成回复              │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  前端渲染                                                    │
│                                                              │
│  1. 工具卡片逐个出现（loading → done）                        │
│  2. AI 文字逐 token 流入                                     │
│  3. 如有 sign_request → 自动弹出 MetaMask                    │
│  4. 签名完成 → 显示 TX hash                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 链路二：哨兵全自动下单（Sentinel Mode）

VPS 情报管线每 15 分钟分析一次，满足条件时自动触发交易，全程无需用户在线。

```
┌─────────────────────────────────────────────────────────────┐
│  VPS 情报管线 (vps-api-index.mjs)                            │
│                                                              │
│  每 15 分钟：                                                │
│  1. fetchCrucix() → 27+ 数据源                               │
│     FRED(VIX/CPI)、GDELT(地缘)、OKX(行情)                    │
│     Reddit、Telegram、加密新闻...                             │
│                                                              │
│  2. fetchNews() → OpenNews AI 评分新闻                       │
│                                                              │
│  3. LLM 分析 → 输出结构化 JSON:                              │
│     {                                                        │
│       macro_risk_score: 61,                                  │
│       crypto_sentiment: 46,                                  │
│       technical_bias: "neutral",                             │
│       recommended_action: "hold" | "strong_buy" | ...,      │
│       confidence: 32,                                        │
│       push_worthy: false,                                    │
│       alerts: [...]                                          │
│     }                                                        │
│                                                              │
│  4. 判断是否触发交易：                                        │
│     ┌─────────────────────────────────────────┐              │
│     │ 保守模式：                               │              │
│     │   push_worthy=true 且 FLASH 级事件       │              │
│     │                                         │              │
│     │ 激进模式：                               │              │
│     │   confidence >= 50 且 action != hold    │              │
│     └─────────────────┬───────────────────────┘              │
│                       │                                      │
│              shouldTrade = true?                             │
│                       │                                      │
│                  ┌────┴────┐                                 │
│                  ▼         ▼                                 │
│                YES        NO → 记录日志，等下一轮              │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/auto-trade (Bearer token 认证)                    │
│                                                              │
│  body: { signal: { macro_risk_score, alerts, ... } }        │
│                                                              │
│  服务端处理：                                                 │
│  1. LLM 收到信号 + 哨兵系统提示词                             │
│  2. LLM 自主决策，调用工具链：                                │
│                                                              │
│     get_session(用户地址)                                     │
│         → 检查 Session 是否 active、余额是否足够              │
│         │                                                    │
│     get_market_signals()                                     │
│         → 获取完整市场信号                                    │
│         │                                                    │
│     get_price()                                              │
│         → 当前 ETH 价格                                      │
│         │                                                    │
│     get_portfolio(用户地址)                                   │
│         → 用户当前持仓                                       │
│         │                                                    │
│     ┌───▼─── LLM 综合判断 ───────────────────┐              │
│     │                                         │              │
│     │  confidence >= 60?                      │              │
│     │  有足够余额?                             │              │
│     │  不超过 maxPerTrade?                    │              │
│     │                                         │              │
│     └────┬──────────────────┬─────────────────┘              │
│          ▼                  ▼                                │
│       执行交易            不操作                              │
│          │                  │                                │
│     session_swap()      输出"本轮不交易"                      │
│     (SessionManager     理由：...                            │
│      链上约束执行)                                            │
│          │                                                   │
│     set_stop_loss()                                          │
│     (AI 代部署 Reactive                                      │
│      client=用户地址)                                         │
│          │                                                   │
│  3. 如果执行了交易：                                          │
│     SSE 广播 SIGNAL_ALERT 到所有前端客户端                    │
│     → Chat 中出现紫色系统消息 [Auto-Trade]                    │
│     → 显示决策理由 + 工具卡片                                 │
│                                                              │
│  4. 如果不操作：                                              │
│     仅记录日志，不打扰用户                                    │
└─────────────────────────────────────────────────────────────┘

每 3 小时（12 轮分析后）：
┌─────────────────────────────────────────────────────────────┐
│  巡逻报告                                                    │
│                                                              │
│  汇总过去 3 小时所有分析记录：                                │
│  → 风险变化趋势                                              │
│  → 情绪变化趋势                                              │
│  → 执行了哪些操作                                            │
│  → 下一步建议                                                │
│                                                              │
│  POST /api/patrol-report → SSE 广播 PATROL_REPORT            │
│  → Chat 中出现巡逻报告卡片                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 止盈止损 Reactive 执行链路

止损/止盈一旦部署，**完全去中心化运行**，不依赖任何后端。

```
部署阶段（用户或 AI 触发）：
┌─────────────────────────────────────────────────────────────┐
│  1. 用户 approve WETH 给 StopOrderCallback (Base)            │
│     → 有 Session 时：用户已在 Enable Auto Trading 时预授权    │
│     → 无 Session 时：前端弹 MetaMask 签 approve              │
│                                                              │
│  2. AI 在 Reactive Network (1597) 代用户部署合约              │
│     → PairOrderManager 或 BaseStopOrderReactive              │
│     → 构造参数中 client = 用户钱包地址                        │
│     → 付 0.1 REACT 作为订阅费                                │
│     → 合约自动订阅 Base 上 WETH/USDC Pair 的 Sync 事件       │
└─────────────────────────────────────────────────────────────┘

监听阶段（完全去中心化，永续运行）：
┌─────────────────────────────────────────────────────────────┐
│  Reactive Network 上的合约：                                  │
│                                                              │
│  每当 Base 上 WETH/USDC Pair 发生交易：                       │
│    → Uniswap 发出 Sync(reserve0, reserve1) 事件              │
│    → Reactive 合约收到事件                                    │
│    → 计算价格：reserve1 * 1e12 / reserve0                    │
│    → 止损：price <= threshold?                               │
│    → 止盈：price >= threshold?                               │
│         │                                                    │
│    ┌────┴────┐                                               │
│    ▼         ▼                                               │
│  未触发      触发！                                           │
│  (等下次)    → 标记 triggered = true（防重复）                │
│              → 发出 Callback 到 Base                         │
│                 (gas limit: 1,000,000)                       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Base 上的 StopOrderCallback.execute()：                     │
│                                                              │
│  1. 验证订单：OrderRegistry.verifyOrder()                    │
│     → 订单是否 active、参数是否匹配                           │
│                                                              │
│  2. 二次验价：再次读取 getReserves()                          │
│     → 价格条件仍然满足？                                     │
│     → 不满足 → emit ExecutionFailed("Price not met")         │
│                                                              │
│  3. 检查余额和授权：                                          │
│     → allowance < amount → emit ExecutionFailed              │
│     → balance < amount → emit ExecutionFailed                │
│     → 不 revert，优雅失败                                    │
│                                                              │
│  4. 执行 swap（try-catch）：                                  │
│     → safeTransferFrom(用户 → callback)                      │
│     → forceApprove(callback → router)                        │
│     → router.swapExactTokensForTokens()                      │
│        滑点：slippageBps（可配置，默认 1%）                    │
│        deadline：block.timestamp + 300s                      │
│     → 成功：                                                 │
│        markExecutedAndCancelLinked(orderId)  ← OCO 联动取消   │
│        emit Executed(orderId, pair, client, amountIn, Out)   │
│     → 失败：                                                 │
│        safeTransfer(用户, amount)  ← 退还代币，资金不丢失     │
│        emit ExecutionFailed("Swap failed")                   │
│                                                              │
│  5. 前端 EventIndexer 检测到事件                              │
│     → SSE 广播 ORDER_EXECUTED                                │
│     → Chat 中显示"订单已执行" + TX hash                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 合约架构

### Base 主网 (8453)

| 合约 | 地址 | 作用 |
|------|------|------|
| SessionManager | `0x5810...0e` | 预算约束：单笔上限、总预算、过期时间 |
| StopOrderCallback | `0x9702...f3` | 止盈止损执行：双重验价、可配置滑点、失败退还 |
| OrderRegistry | `0xcE97...98` | 链上订单簿，支持 OCO（一取消另一） |
| Callback Proxy | `0x0D3E...47` | Reactive Network 官方代理 |

### Reactive 主网 (1597)

| 合约 | 地址 | 作用 |
|------|------|------|
| PairOrderManager | `0x3421...11` | 订阅 Uniswap Sync 事件，价格触发时调用 Callback |

### 止损执行流程

```
1. 用户创建 Session → 同时 approve WETH/USDC 给 Router + Callback
2. AI 调用 set_stop_loss(数量, 阈值, 用户地址)
3. AI 在 Reactive 网络代用户部署监听合约（client = 用户地址）
4. PairOrderManager 监听 Base 上的 Uniswap Sync 事件
5. 价格 <= 阈值 → 触发 StopOrderCallback.execute()
6. Callback：再次验价 → transferFrom 用户 → swap → 发送到用户钱包
7. 如果 swap 失败：safeTransfer 退还代币（资金不会丢失）
```

---

## 哨兵模式（Sentinel Mode）

```
VPS 每 15 分钟执行一次：

┌─────────────────────────┐
│ 拉取 Crucix（27 源）     │ ← FRED, GDELT, ACLED, OKX, Reddit, Telegram...
│ 拉取加密新闻（OpenNews） │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ LLM 分析                 │
│ → 宏观风险指数 (0-100)    │
│ → 加密情绪指数 (0-100)    │
│ → 技术倾向 (多/空/中性)   │
│ → 建议操作                │
│ → 置信度 (0-100)          │
│ → 是否推送 (bool)         │
└───────────┬─────────────┘
            ▼
┌─────────────────────────────────────────┐
│ 保守模式：push_worthy + 仅 FLASH 事件    │
│ 激进模式：置信度 > 50 + 有方向性信号       │
└───────────┬─────────────────────────────┘
            ▼
POST /api/auto-trade（Bearer token 认证）
→ LLM 决策：session_swap / set_stop_loss / 不操作
→ SSE 广播到所有连接的客户端
```

---

## 目录结构

```
RIFI/
├── src/                              # 智能合约（Solidity）
│   ├── StopOrderCallback.sol         # 止盈止损回调 + SafeERC20 + try-catch
│   ├── PairOrderManager.sol          # Reactive 事件监听器
│   ├── OrderRegistry.sol             # 订单簿 + OCO
│   └── SessionVault.sol              # Session Key 预算约束
│
├── script/
│   └── DeployBaseStopOrder.s.sol     # Base + Reactive 部署脚本
│
├── web/
│   ├── src/app/
│   │   ├── page.tsx                  # 着陆页（视频背景 + 标语）
│   │   ├── chat/page.tsx             # 聊天布局（三栏 + 背景波浪）
│   │   └── api/
│   │       ├── chat/route.ts         # SSE 流式聊天 + 工具执行
│   │       ├── auto-trade/route.ts   # 哨兵自动交易端点
│   │       ├── portfolio/route.ts    # 支持 ?wallet= 参数
│   │       ├── orders/route.ts       # 按钱包筛选订单
│   │       ├── sentinel-mode/route.ts# 哨兵模式切换
│   │       ├── events/route.ts       # SSE 推送（自动交易事件）
│   │       └── signals/route.ts      # 代理 VPS 信号
│   │
│   ├── src/components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx        # 流式聊天 + sign_request 处理
│   │   │   └── ToolCallCard.tsx      # Lucide 图标工具卡片
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # 导航 + 聊天历史
│   │   │   └── RightPanel.tsx        # 资产 + 订单 + 哨兵 + Session
│   │   └── providers/
│   │       └── Web3Provider.tsx      # Wagmi + ConnectKit（Base + RNK）
│   │
│   └── src/lib/
│       ├── llm/
│       │   ├── executor.ts           # executeTool(名称, 参数, 用户地址)
│       │   ├── tools.ts              # 11 个工具定义
│       │   ├── system-prompt.ts      # AI 人设 + 规则
│       │   └── client.ts             # OpenAI 兼容客户端
│       ├── chain/
│       │   ├── config.ts             # 合约地址 + ABI + 客户端
│       │   ├── portfolio.ts          # getPortfolio(钱包地址?)
│       │   ├── swap.ts               # marketSwap() + buildSwapTxs()
│       │   ├── stop-order.ts         # setStopLoss(client?) + buildStopLossTxs()
│       │   ├── session.ts            # sessionSwap(用户地址)
│       │   ├── price.ts              # Uniswap 对的储备量
│       │   └── event-indexer.ts      # 轮询 + 追踪订单
│       ├── sse/
│       │   ├── push-service.ts       # SSE 广播单例
│       │   └── signal-hub.ts         # VPS 轮询 → 分级 → 推送
│       └── memory/
│           └── index.ts              # 按钱包存储用户记忆
│
├── vps-api-index.mjs                 # VPS 情报管线
├── README.md                         # 项目概览（英文）
├── ARCHITECTURE.md                   # 架构文档（英文）
├── DEMO-SCRIPT.md                    # 5 分钟 Demo 脚本
└── foundry.toml                      # Forge 配置
```

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI 兼容 LLM |
| 区块链 | Base (8453) + Reactive Network (1597) |
| 合约 | Solidity 0.8+, Foundry, OpenZeppelin (SafeERC20) |
| 实时通信 | Server-Sent Events (SSE) |
| 情报引擎 | 27+ OSINT 数据源（Crucix 聚合） |
