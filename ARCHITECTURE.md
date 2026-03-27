# RIFI - Reactive Intelligence for Financial Instruments

> AI Native 自主交易系统 | Base Chain | Reactive Smart Contracts

## 一句话

AI 实时聚合 27+ 数据源情报，自主决策下单，链上 Reactive 合约去中心化执行止盈止损。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Web UI (Next.js)                         │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │  Chat Mode   │  │  Auto Mode   │  │  Crucix 3D Globe  │ │
│  │  对话下单     │  │  AI自主交易   │  │  实时情报地图       │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────────────┘ │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│               AI Decision Engine (GPT-5.4)                  │
│               Tool Calling / Function Calling               │
│                                                             │
│  ┌─── 基本面 Tools ───┐  ┌─── 技术面 Tools ───┐            │
│  │ crucix_intel()      │  │ get_kline()         │            │
│  │ get_news_signal()   │  │ get_onchain_data()  │            │
│  │ get_twitter_kol()   │  │ get_smart_money()   │            │
│  │ get_daily_digest()  │  │ get_token_analysis() │           │
│  └────────────────────┘  └─────────────────────┘            │
│                                                             │
│  ┌─── 执行 Tools ─────┐  ┌─── 查询 Tools ─────┐            │
│  │ market_swap()       │  │ get_portfolio()     │            │
│  │ set_stop_loss()     │  │ get_order_status()  │            │
│  │ set_take_profit()   │  │ get_price()         │            │
│  │ place_limit_order() │  │ get_pnl()           │            │
│  │ cancel_order()      │  │                     │            │
│  └────────────────────┘  └─────────────────────┘            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Order Execution Layer                        │
│                                                             │
│  市价单 ──→ Uniswap V2 Router.swapExactTokensForTokens()   │
│  限价买 ──→ Reactive Contract (price <= target → buy)       │
│  止损   ──→ Reactive Contract (price <= threshold → sell)   │
│  止盈   ──→ Reactive Contract (price >= threshold → sell)   │
│                                                             │
│  Session Key / Approve 模式: 用户授权后 AI 自主执行          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    Base Chain (8453)
                  Reactive Network (1597)
```

---

## 双模型情报管道

```
┌──────────────────────────────────────────────┐
│           27+ 原始数据源 (海量)                │
│                                               │
│  地缘政治: GDELT, ACLED, OpenSanctions        │
│  宏观经济: FRED(VIX/CPI/收益率), 美国国债      │
│  市场:     Yahoo Finance, 加密行情             │
│  卫星:     NASA FIRMS, OpenSky, CelesTrak     │
│  社交:     Reddit, Bluesky, Telegram 17频道   │
│  加密新闻: OpenNews MCP                        │
│  CT情绪:   OpenTwitter MCP                     │
│  每日摘要: Daily News                          │
└──────────────────┬───────────────────────────┘
                   │ 每15分钟 ~50,000 tokens
                   ▼
┌──────────────────────────────────────────────┐
│         Qwen 3.5 0.8b (硅谷VPS)              │
│         预处理 / 过滤 / 压缩层                 │
│                                               │
│  • 判断与 crypto 的相关性 (0-100)              │
│  • 压缩为结构化 JSON                           │
│  • 分级: FLASH / PRIORITY / ROUTINE           │
│  • 提取关键信号和数据点                         │
│                                               │
│  输出: ~500 tokens 结构化信号                   │
└──────────────────┬───────────────────────────┘
                   │ 只传高分信号
                   ▼
┌──────────────────────────────────────────────┐
│         GPT-5.4 (API 按需调用)                │
│         决策 / 执行 / 对话层                    │
│                                               │
│  输入: 压缩情报 + 持仓 + 技术面 + 用户指令      │
│  输出: 交易决策 + 执行指令 + 理由               │
└──────────────────────────────────────────────┘
```

### 信号 JSON 格式

```json
{
  "timestamp": "2026-03-26T08:00:00Z",
  "macro_risk_score": 35,
  "crypto_sentiment": 72,
  "alerts": [
    {
      "level": "FLASH",
      "signal": "VIX 突破 25，避险情绪升温",
      "source": "FRED",
      "relevance": 85
    },
    {
      "level": "PRIORITY",
      "signal": "ETH 大户 3h 内转出 12k ETH 到交易所",
      "source": "OKX OnchainOS",
      "relevance": 92
    }
  ],
  "news_digest": "Fed 维持利率不变，市场反应平淡...",
  "technical_bias": "short",
  "recommended_action": "reduce_exposure"
}
```

---

## 部署拓扑

```
┌──────────────────────────────────┐
│  硅谷 VPS (2核4G Ubuntu 24)      │
│                                   │
│  ┌────────────┐ ┌──────────────┐ │
│  │  Crucix     │ │ Qwen 0.8b   │ │
│  │  情报引擎   │ │ (Ollama)     │ │
│  │  :3117      │ │ :11434       │ │
│  └────────────┘ └──────────────┘ │
│                                   │
│  API 暴露:                        │
│  GET /api/signal → 压缩后的信号   │
│  SSE /events    → 实时推送        │
└──────────────────────────────────┘
          │
          │ HTTPS
          ▼
┌──────────────────────────────────┐
│  本地开发 / Vercel 部署           │
│                                   │
│  ┌────────────┐ ┌──────────────┐ │
│  │  Next.js    │ │ Backend API  │ │
│  │  前端       │ │ GPT-5.4      │ │
│  │  :3000      │ │ Tool Calling │ │
│  └────────────┘ └──────────────┘ │
│                                   │
│  链上交互:                        │
│  Base RPC → Uniswap / Reactive   │
└──────────────────────────────────┘
```

---

## 合约架构 (Base Chain)

### 已部署合约（v2 — 多订单 + OCO + Session Key）

| 合约 | 链 | 地址 | 用途 |
|------|-----|------|------|
| OrderRegistry | Base | `0xcE9720Ae1185e8E8c5739A5d3f88D75F3823D698` | 链上订单簿，OCO 联动 |
| StopOrderCallback | Base | `0x196cD2F30dF3dFA3ecD7D536db43e98Fd97fcC5f` | 止盈止损执行 + 二次验价 + 0.5%滑点 |
| PairOrderManager | RNK | `0x342168e8D2BF8315BbF72F409A94f1EC7570f611` | Reactive 多订单监听 WETH/USDC |
| SessionVault | Base | `0xEF1581bfDfC71b079247Df9b5e6127D686fd0682` | Session Key 有限授权 |
| Callback Proxy | Base | `0x0D3E76De6bC44309083cAAFdB49A088B8a250947` | Base 官方代理 |
| Uniswap V2 Router | Base | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | DEX 路由 |
| WETH/USDC Pair | Base | `0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C` | 价格监听目标 |

### 验证记录

- 简化版测试（TX `0x600e...`）：自然 Sync 触发成功
- 多订单版测试（TX `0xc6f0...`）：OrderRegistry → PairOrderManager → StopOrderCallback 全链路通过
- resetOrder 重试机制验证通过

### 订单类型 → 合约映射

```
市价单 (Market Order)
└─→ 直接调用 Uniswap V2 Router
    swapExactTokensForTokens()
    一笔 TX 完成

止损 (Stop Loss)
└─→ Reactive Contract 监听 Sync 事件
    price <= threshold → 触发 Callback → swap 卖出
    去中心化执行，无需后端在线

止盈 (Take Profit)
└─→ Reactive Contract 监听 Sync 事件
    price >= threshold → 触发 Callback → swap 卖出
    去中心化执行，无需后端在线

限价买 (Limit Buy)
└─→ Reactive Contract 监听 Sync 事件
    price <= target → 触发 Callback → swap 买入
    去中心化执行，无需后端在线
```

---

## Web UI 页面

### Chat Mode
```
┌─────────────────────────────────────────┐
│  RIFI AI Trading Assistant              │
├─────────────────────────────────────────┤
│                                         │
│  User: 帮我买 0.1 ETH，止损设在 2000    │
│                                         │
│  AI: 分析中...                          │
│  📊 当前 ETH: $2,118                    │
│  📰 基本面: 中性偏多 (score: 65)         │
│  📈 技术面: RSI 55, MA 上方             │
│                                         │
│  ✅ 已执行:                             │
│  • 买入 0.1 ETH @ $2,118               │
│  • 止损设置 @ $2,000 (Reactive)         │
│  • TX: 0xabc...123                      │
│                                         │
├─────────────────────────────────────────┤
│  [输入消息...]                    [发送] │
└─────────────────────────────────────────┘
```

### Auto Mode Dashboard
```
┌────────────────┬────────────────────────┐
│  情报面板       │  Crucix 3D Globe       │
│                │  (实时地缘事件地图)      │
│  FLASH ⚡      │                        │
│  VIX > 25      │     🌍                 │
│                │                        │
│  PRIORITY ⚠️   │                        │
│  ETH 大户出货   │                        │
├────────────────┼────────────────────────┤
│  持仓           │  AI 决策日志            │
│                │                        │
│  ETH: 0.5      │  08:00 买入 0.1 ETH    │
│  USDC: 500     │  理由: 技术面超卖反弹   │
│  PnL: +$23     │  置信度: 78%           │
│                │                        │
│  活跃订单       │  08:15 设置止损 $2000  │
│  SL @ $2000 🟢 │  理由: 支撑位下方 2%   │
│  TP @ $2300 🟢 │                        │
└────────────────┴────────────────────────┘
```

---

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 前端 | Next.js 14 + TailwindCSS | SSR + 实时更新 |
| 3D 地图 | Globe.gl (Crucix 内置) | 情报可视化 |
| AI 决策 | GPT-5.4 Function Calling | 核心大脑 |
| AI 预处理 | Qwen 3.5 0.8b (Ollama) | 信号过滤压缩 |
| 情报引擎 | Crucix (27源 OSINT) | 基本面数据 |
| 加密新闻 | OpenNews MCP | 链上新闻 |
| 社交情绪 | OpenTwitter MCP | CT/KOL |
| 技术分析 | OKX OnchainOS | K线/链上 |
| 链上执行 | Solidity + Foundry | 合约 |
| 止盈止损 | Reactive Smart Contracts | 去中心化触发 |
| 区块链 | Base (8453) | 低 gas |
| 部署 | Ubuntu 24 VPS (硅谷) | 情报+小模型 |

---

## 数据源清单

### 基本面 (Crucix 27源 + 3 MCP)

| 分类 | 数据源 | 用途 |
|------|--------|------|
| 地缘政治 | GDELT, ACLED, OpenSanctions, ReliefWeb, WHO, OFAC | 冲突/制裁/风险事件 |
| 宏观经济 | FRED, US Treasury, BLS, EIA, GSCPI, USAspending | VIX/CPI/利率/能源 |
| 市场 | Yahoo Finance | SPY/QQQ/BTC/黄金/石油 |
| 卫星/航空 | NASA FIRMS, OpenSky, ADS-B, CelesTrak | 异常活动检测 |
| 环境 | NOAA, EPA RadNet, Safecast | 自然灾害/核异常 |
| 社交 | Reddit, Bluesky, Telegram 17频道 | 舆情 |
| 加密新闻 | OpenNews MCP | 链上生态新闻 |
| CT 情绪 | OpenTwitter MCP | KOL/大V观点 |
| 每日摘要 | Daily News | 综合日报 |

### 技术面 (OKX OnchainOS)

| 能力 | 用途 |
|------|------|
| K 线数据 | 价格走势/技术指标 |
| 链上分析 | 持仓分布/大户动向 |
| 智能钱包追踪 | Smart Money 信号 |
| Token 分析 | 流动性/持仓者/市值 |
| DEX 行情 | 实时价格/深度 |

---

## 全自动决策循环

```
每 15 分钟:
│
├─ 1. Crucix 扫描 27 源 → 原始情报
│
├─ 2. Qwen 0.8b 过滤压缩 → 结构化信号 JSON
│
├─ 3. GPT-5.4 综合分析:
│     ├─ 读取信号 JSON (基本面)
│     ├─ 调用 OKX OnchainOS (技术面)
│     ├─ 查询当前持仓和活跃订单
│     └─ 输出决策: { action, token, amount, confidence, reason }
│
├─ 4. confidence > 阈值?
│     ├─ YES → 执行交易 + 设置止盈止损
│     └─ NO  → 记录分析，不操作
│
├─ 5. 推送决策到前端 + 存储日志
│
└─ 6. 监控活跃订单状态
```

---

## AI Native 亮点 (黑客松叙事)

1. **不是 AI 聊天框 + swap 按钮** — AI 是真正的操盘手，从情报采集到链上执行全自主
2. **双模型管道** — 边缘模型实时过滤，大模型高阶决策，成本效率最优
3. **27 源跨域关联** — VIX 飙升 + 中东冲突 + 收益率曲线倒挂 = AI 判断避险减仓
4. **去中心化执行** — Reactive 合约链上自动止盈止损，不依赖后端在线
5. **3D 情报可视化** — 地缘事件实时映射到交易决策，评委一眼看懂
6. **全链路可追溯** — 每笔交易附带 AI 决策理由 + 数据来源 + 置信度
