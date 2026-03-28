# RIFI Edge Case & Exception Handling Audit

> 针对 CasualHackathon "Let's Vibe Reactive dApp" 评分维度 **Correctness & Edge Cases** 的全面审计
>
> 评分标准：Real-world logic validity, exception handling, boundary condition coverage

---

## 一、价格触发边界条件

### 1.1 价格恰好等于触发阈值时，算触发还是不触发？

**代码位置：**
- `PairOrderManager.sol:168-173`
- `StopOrderCallback.sol:80-86`

**当前实现：**
```solidity
// PairOrderManager (Reactive 侧)
conditionMet = o.isStopLoss ? (val <= o.threshold) : (val >= o.threshold);

// StopOrderCallback (Base 侧 double-check)
priceOk = isStopLoss ? (val <= threshold) : (val >= threshold);
```

**结论：** `<=` / `>=`，**恰好等于 = 触发**。这是正确的金融行为——止损价到达即执行。

**状态：✅ 已正确处理**

---

### 1.2 价格在同一区块内跨越止损线（从高于跳到低于），没有"恰好等于"的时刻

**分析：** Uniswap V2 的 Sync 事件在每笔 swap 后发出 `(reserve0, reserve1)`。如果一个区块内有多笔 swap：
- 每笔 swap 都会发出 Sync 事件
- PairOrderManager 的 `react()` 对每个 Sync 事件独立评估
- 只要任何一个 Sync 的储备比率满足条件，就会触发

**但存在问题：** 如果区块内只有一笔大交易直接将价格从 2100 打到 1900（跳过 2000），Sync 事件的 reserves 反映的是最终状态（1900），`val <= 2000` 成立，**依然会触发**。

**状态：✅ 已正确处理**（Sync 反映最终状态，不需要"恰好等于"）

---

### 1.3 OCO 订单中，止盈和止损同时触发（同一区块内两个事件都满足）

**代码位置：** `OrderRegistry.sol:115-119` + `PairOrderManager.sol:162-196`

**场景：** 用户设 SL=2000, TP=2200。同一区块内价格先涨到 2200 再跌到 1900，两个 Sync 事件都满足各自条件。

**当前处理：**

1. **Reactive 侧 (PairOrderManager)：**
   - 遍历所有 active 且未 triggered 的订单
   - 第一个满足条件的订单被标记 `o.triggered = true`
   - 第二个订单在同一次 `react()` 调用中如果也满足条件，**也会被标记 triggered**
   - 两个 Callback 都会发出

2. **Base 侧 (StopOrderCallback → OrderRegistry)：**
   - 第一个执行的 callback 调用 `markExecutedAndCancelLinked(orderId)`
   - 这将该 order 标记 inactive，**同时将 linked order 也标记 inactive**
   - 第二个 callback 到达时，`verifyOrder()` 检查 `o.active` → **false** → 返回 false
   - Callback emit `ExecutionFailed("Order verification failed")` 然后 return

**结论：** OCO 在 OrderRegistry 层正确实现。即使两个 reactive callback 几乎同时到达，只有先执行的那个成功，另一个被 linked cancel 阻止。

**但有一个竞态风险：** 如果两个 callback 在**同一个 Base 交易**中执行（理论上不会，因为每个 callback 是独立交易），但如果 Reactive Network 将它们打包到同一个 L1 交易中，执行顺序由 EVM 保证（sequential within tx）。

**状态：✅ 已正确处理（通过 OrderRegistry.linkedOrderId 机制）**

⚠️ **注意：** 简单版 `StopOrderCallback.sol`（当前 Base 部署版）**没有使用 OrderRegistry 的 linked 功能**——它在 `stop-order.ts` 中部署的是独立的 Reactive 合约，每个 SL/TP 是独立部署。如果要用 OCO，需要走 OrderRegistry 流程。

---

## 二、价格异常情况

### 2.1 预言机价格数据异常

**当前架构：** RIFI 不使用 Chainlink 等预言机，直接读取 Uniswap V2 Pair 的 `getReserves()`。

**风险：** Uniswap 池可被操纵（闪电贷攻击、大额交易）。

**当前防护：**
- `PairOrderManager.sol:160`: `if (reserve0 == 0 || reserve1 == 0) return;` — 仅防零值
- **无 TWAP 保护**
- **无价格偏差检查**（如与上一个区块比较超过 X% 则忽略）

**状态：⚠️ 已知限制（MVP 阶段可接受，需在文档中说明）**

**建议：** 添加 price sanity check，如 `abs(newPrice - lastPrice) / lastPrice > 50%` 时跳过触发，或引入 Uniswap V2 TWAP。

---

### 2.2 闪崩/插针：价格瞬间触发止损又弹回，执行几次？

**分析链路：**

1. **PairOrderManager:** 第一个满足条件的 Sync → `o.triggered = true` → emit Callback
2. `triggered = true` 后，后续 Sync 事件不再触发该订单（`if (!o.active || o.triggered) continue;`）
3. Callback 执行成功 → `markExecutedAndCancelLinked()` → order inactive
4. Callback 执行失败 → emit `ExecutionFailed` → order 留在 triggered 状态

**结论：** **只执行一次。** `triggered` flag 防止重复触发。

**但如果 callback 失败：**
- `PairOrderManager` 中的 `triggered = true` 阻止了自动重试
- 需要通过 `RESET_TOPIC` 事件（`OrderRegistry.resetOrder()`）手动重置 `triggered = false` 才能重试
- 当前代码中 `resetOrder()` 只有 `onlyBackend` 能调用

**ArbitrumStopOrderCallback（高级版）有完整重试逻辑：**
- 5 次重试，30 秒冷却，超过标记 Failed
- 但 Base 版 `StopOrderCallback` **无重试逻辑**

**状态：✅ 不会重复执行（triggered flag 保护）**
**状态：⚠️ Base 版失败后无自动重试（ArbitrumCallback 有，Base Callback 没有）**

---

### 2.3 Reactive 合约监听到事件但链上价格已经变化（延迟）

**防护机制：** **双重价格检查**

1. **Reactive 侧 (PairOrderManager):** 根据 Sync 事件的 reserves 判断触发
2. **Base 侧 (StopOrderCallback:77-86):** 执行时**再次读取** `pair.getReserves()` 并检查价格条件

```solidity
// StopOrderCallback.sol:77
(uint112 r0, uint112 r1,) = pairContract.getReserves();
// ... recalculate price ...
if (!priceOk) {
    emit ExecutionFailed(orderId, client, "Price not met");
    return;
}
```

**如果 Reactive 触发时价格满足，但 Base callback 执行时价格已回升：**
→ `priceOk = false` → `emit ExecutionFailed("Price not met")` → 不执行 swap

**状态：✅ 已正确处理（双重价格验证）**

---

### 2.4 滑点设置：用户设 1% 滑点，但市场已移动 1.5%

**代码位置：**
- `StopOrderCallback.sol:112`: `amountOutMin = expectedOut * 995 / 1000` — **硬编码 0.5%**
- `swap.ts:56`: `minAmountOut = (amountsOut[1] * 99n) / 100n` — **硬编码 1%**
- `ArbitrumStopOrderCallback.sol`: 用户可配置 `slippageBps`（0-1000，即 0-10%）

**问题：**
- Base 版 callback 硬编码 0.5% 滑点，用户无法自定义
- 如果市场移动 > 0.5%，Uniswap router 的 `swapExactTokensForTokens` 会 **revert**
- Revert 导致整个 callback 交易失败

**Revert 后果：**
- `StopOrderCallback` 中 swap revert → **整个 execute() 交易回滚**
- `registry.markExecutedAndCancelLinked()` 不会被调用
- Order 在 Registry 中仍为 active
- 但 PairOrderManager 中 `triggered = true`，不会自动重试

**状态：❌ 需要修复**
- Base 版滑点硬编码 0.5%，极端行情下必定失败
- 失败后无重试机制（与 Arbitrum 版不同）

**建议：**
1. 将 slippage 改为构造函数参数或 order 级别配置
2. 使用 try-catch 包裹 swap 调用，失败时 emit event 而非 revert
3. 或参考 ArbitrumStopOrderCallback 的重试逻辑

---

### 2.5 执行时用户余额不足

**代码位置：** `StopOrderCallback.sol:98-102`

```solidity
uint256 allowance = IERC20(tokenSell).allowance(client, address(this));
if (allowance < amount) {
    emit ExecutionFailed(orderId, client, "Insufficient allowance");
    return;
}
require(IERC20(tokenSell).transferFrom(client, address(this), amount), "Transfer failed");
```

**分析：**
- 检查 allowance → 如果不足，graceful fail (emit event, return)
- `transferFrom` 检查 balance → 如果 balance < amount，**revert "Transfer failed"**
- 这会导致整个交易回滚，包括之前的所有状态变更

**差异对比：**
- **ArbitrumStopOrderCallback**: `execAmt = Math.min(amount, Math.min(balance, allowance))`，支持部分执行
- **Base StopOrderCallback**: 全额或失败，无部分执行

**状态：⚠️ Base 版不支持部分执行，余额不足直接 revert**

---

### 2.6 部分成交：池子流动性不够

**当前处理：** Uniswap V2 Router 的 `swapExactTokensForTokens` 要求精确输入数量。如果池子流动性不足以提供 `amountOutMin`，交易 revert。

**Base 版：** 直接 revert，无降级处理
**Arbitrum 版：** 通过 `execAmt = min(amount, balance, allowance)` 可以减少输入量，但如果池子本身无法满足，仍会 revert

**状态：⚠️ 无部分成交降级处理**

---

### 2.7 合约调用 Uniswap 时 gas 不足

**Gas 配置：**
- `PairOrderManager.sol:27`: `GAS_LIMIT = 1_000_000` (1M gas for callback)
- `ArbitrumStopOrderReactive`: `CALLBACK_GAS_LIMIT = 600_000` (600K gas)

**分析：** 一个 ERC20 approve + transferFrom + Uniswap swap 大约消耗 150K-300K gas。1M gas 应该充足。

**但如果 gas 不足：** Callback 交易 revert，效果同滑点失败——order 卡在 triggered 状态。

**状态：✅ Gas limit 设置合理（1M），但无 gas 不足降级处理**

---

### 2.8 Uniswap 合约升级或地址变更

**当前：** Router 地址在合约构造函数中 immutable（`StopOrderCallback` constructor 参数）。

**如果 Uniswap 升级地址：** 所有已部署的 callback 合约将永久失效。需要：
1. 部署新的 callback 合约指向新 router
2. 用户重新创建订单
3. 旧的 reactive 合约仍会尝试调用旧 callback → 失败

**状态：⚠️ 已知限制（不可升级 immutable 设计，MVP 可接受）**

---

### 2.9 网络拥堵导致 Reactive 合约响应延迟

**影响：** Reactive Network 到 Base 的 callback 延迟可能导致价格在 trigger 和 execute 之间发生变化。

**防护：** Base 侧 callback 的双重价格检查（§2.3）+ swap deadline（`block.timestamp + 300`，5 分钟）。

**状态：✅ 已有双重验证保护**

---

## 三、Session / Dead Man's Switch 边界

### 3.1 用户在 deadline 前最后一秒 check-in

**SessionVault.sol:85:**
```solidity
require(block.timestamp < s.expiresAt, "Session expired");
```

**注意：** 是 `<` 不是 `<=`。`block.timestamp == expiresAt` 时**视为过期**。

**精度：** EVM 的 `block.timestamp` 精度为秒级，由矿工/sequencer 设定，可能有几秒偏差。

**状态：✅ 边界定义清晰（strict < 比较）**

---

### 3.2 用户在 trigger 触发的同一区块内 check-in

**分析：** Session expiry 和 order trigger 是独立机制。如果同一区块内：
1. Session swap 交易先于 trigger 执行 → Session 扣减预算成功
2. Trigger callback 先执行 → 如果 trigger 消耗了用户 token，session swap 可能余额不足

**EVM 保证：** 同一区块内交易顺序由 sequencer 决定（Base L2），用户无法控制。

**状态：⚠️ 理论竞态条件存在，但概率极低**

---

### 3.3 紧急平仓时市场无流动性

**当前：** 无重试机制（Base 版）。Swap revert → 订单卡住。

**ArbitrumStopOrderCallback 有重试：** 5 次 / 30 秒间隔。但如果池子持续无流动性，5 次后标记 Failed。

**状态：⚠️ Base 版无重试，Arbitrum 版有但有限**

---

### 3.4 触发条件达成，但用户已手动平仓（仓位为 0）

**StopOrderCallback.sol:98-104:**
```solidity
uint256 allowance = IERC20(tokenSell).allowance(client, address(this));
if (allowance < amount) {
    emit ExecutionFailed(orderId, client, "Insufficient allowance");
    return;
}
require(IERC20(tokenSell).transferFrom(client, address(this), amount), "Transfer failed");
```

**场景：** 用户手动卖出所有 WETH 后，止损触发：
- allowance 可能仍然足够（approve 未撤销）
- 但 `transferFrom` 时 balance = 0 → **revert "Transfer failed"**
- 整个 callback 交易回滚

**问题：** 这是一个 **revert** 而非 graceful failure。Gas 浪费且 order 不会被标记为 failed/cancelled。

**改进建议：** 在 transferFrom 前检查 balance：
```solidity
uint256 balance = IERC20(tokenSell).balanceOf(client);
if (balance < amount) {
    emit ExecutionFailed(orderId, client, "Insufficient balance");
    registry.markExecutedAndCancelLinked(orderId); // clean up
    return;
}
```

**状态：❌ 需要修复（revert 而非 graceful fail）**

---

### 3.5 合约执行过程中用户 revoke 授权

**分析：** EVM 交易是原子性的。如果 callback 已经开始执行，用户无法在同一交易中途 revoke。Revoke 只能在下一个交易中生效。

**但如果用户在 trigger 和 callback 之间 revoke：**
→ `allowance < amount` → `emit ExecutionFailed("Insufficient allowance")` → graceful fail

**状态：✅ 已正确处理（allowance 检查在 execute 时刻进行）**

---

### 3.6 多个 Dead Man's Switch 同时到期

**当前架构中无 Dead Man's Switch 合约**。SessionVault 有 expiry 但不是 DMS 模式。如果后续实现 DMS，需考虑多个 session 同时到期时的 gas 竞争。

**状态：N/A（当前未实现 DMS）**

---

## 四、Reactive 合约架构

### 4.1 同一 Origin 事件被多个 Reactive 合约订阅，执行顺序

**架构：** 每个 `PairOrderManager` 实例订阅同一个 Pair 的 Sync 事件。如果部署了多个实例：
- Reactive Network 将事件分发给所有订阅者
- 每个订阅者独立执行 `react()`
- 各自发出 Callback
- **Base 侧执行顺序不确定**（取决于 sequencer 排序）

**风险：** 同一用户通过不同 Reactive 合约创建的相同订单可能都尝试执行。

**防护：** `OrderRegistry.verifyOrder()` 检查 `o.active`。第一个成功的 callback 将 order 标记为 inactive，后续 callback 被拒绝。

**状态：✅ OrderRegistry 层面防止重复执行**

---

### 4.2 链发生 reorg 后，已执行的操作如何处理

**Base (L2) Reorg：** Base 作为 OP Stack L2，finality 由 L1 保证。在 L2 层面 reorg 极罕见。

**Reactive Network Reorg：** 如果 Reactive Network reorg：
- 已发出的 Callback 可能被回滚
- Base 侧已执行的 swap 不受影响（独立 finality）
- 可能导致同一事件被重新处理 → 再次发出 Callback → Base 侧 `verifyOrder()` 拒绝（order 已 inactive）

**状态：✅ OrderRegistry + triggered flag 提供幂等保护**

---

### 4.3 Reactive 合约的回调 gas limit 刚好卡在边界值

**当前设置：**
- `PairOrderManager`: `GAS_LIMIT = 1_000_000`
- `ArbitrumStopOrderReactive`: `CALLBACK_GAS_LIMIT = 600_000`

**分析：** ERC20 approve (~46K) + transferFrom (~65K) + Uniswap swap (~150K) + state updates (~50K) ≈ 311K gas。1M gas limit 有 3x 余量。

**状态：✅ 充足余量**

---

### 4.4 Reactive Network 暂时离线，事件是否丢失

**依赖 Reactive Network 架构：** Reactive Network 维护事件队列。如果暂时离线：
- Origin chain 事件仍被记录在 Origin chain 上
- Reactive Network 恢复后应从上次处理的区块继续

**但：** 这取决于 Reactive Network 的 SLA。如果事件窗口被错过且无重放机制，订单可能永远不会触发。

**状态：⚠️ 依赖 Reactive Network 可靠性（项目层面无法控制）**

---

### 4.5 Reactive 合约内部状态竞态条件

**`PairOrderManager.react()` 是 `vmOnly`（只在 Reactive VM 中执行）。** Reactive Network 的执行模型是顺序的——同一合约不会并发执行 `react()`。

**状态：✅ 无竞态（Reactive VM 顺序执行）**

---

### 4.6 Testnet 与主网行为不一致

**已知风险。** 当前合约在 Base mainnet 上运行。Reactive Lasna Testnet 的行为差异属于 Reactive Network 层面问题。

**缓解：** 在 Base mainnet + Reactive mainnet 上测试和部署。

**状态：⚠️ 需在文档中声明测试环境差异**

---

## 五、AI / LLM 异常

### 5.1 用户设置矛盾指令

**示例：** "永远不要止损" + "跌 10% 自动平仓"

**当前处理：** 完全依赖 LLM 的推理能力。`system-prompt.ts` 中有指令：
- 每次交易前检查价格
- 每次操作评估风险
- 记录决策到 memory

**无硬编码冲突检测逻辑。**

**状态：⚠️ 依赖 LLM 智能判断，无规则引擎兜底**

---

### 5.2 Memory 中的历史指令与当前链上状态不一致

**当前处理：** `executor.ts` 中每次操作都**实时读链上数据**：
- `get_price()` → 实时 reserves
- `get_portfolio()` → 实时 balance
- `get_session()` → 实时 session 状态
- `get_active_orders()` → 内存中的 order 状态

**Memory 只用于 LLM 推理辅助，不用于执行决策。** 链上数据始终优先。

**状态：✅ 链上数据优先于 memory**

---

### 5.3 Claude API 超时或返回格式异常

**代码位置：** `web/src/app/api/chat/route.ts`

**当前处理：** `executor.ts` 的 try-catch 包裹所有 tool execution：
```typescript
catch (error) {
    return JSON.stringify({ error: String(error) })
}
```

**LLM 调用侧：** 使用 OpenAI SDK，有内置 timeout。如果 LLM 返回非法 JSON 或超时：
- SDK 抛异常
- API route 的 catch 返回 500

**状态：✅ 基本错误处理存在，但缺乏重试和降级**

---

### 5.4 AI 解析出的参数超出合约允许范围

**示例：** AI 输出 `amount: "999999999"` 但用户只有 0.1 WETH

**防护层：**
1. **LLM System Prompt** 要求 "Never trade more than available"
2. **链上验证**：`transferFrom` 在 balance 不足时 revert
3. **SessionVault**：`amount <= maxPerTrade` 和 `spent + amount <= totalBudget`

**缺少的层：** TypeScript 侧（executor.ts）无 pre-validation。参数直接传给链上合约。

**建议：** 在 executor 中添加 off-chain pre-check：
```typescript
const balance = await getBalance(token);
if (amount > balance) return { error: "Amount exceeds balance" };
```

**状态：⚠️ 依赖链上 revert，无 off-chain 预检**

---

## 六、其他工程问题

### 6.1 cancel_order 的实现方式

**代码位置：** `executor.ts:105-130`

**当前实现：** 将 WETH 对 callback 的 allowance 设为 0。

**问题：** 如果用户有多个 active order，revoke 一个的 allowance 会导致**所有**订单都无法执行（它们共享同一个 allowance target）。

**状态：❌ 设计缺陷——revoke allowance 影响所有同 callback 的订单**

**建议：** 改为通过 `OrderRegistry.cancelOrder()` 取消特定 orderId，而非全局 revoke。

---

### 6.2 Event Indexer 的内存状态丢失

**`event-indexer.ts:23`**: `const orders: Map<number, IndexedOrder> = new Map()`

**问题：** 服务器重启后所有 order 追踪丢失。前端显示的 active orders 清空。

**缓解：** 链上状态（OrderRegistry）不受影响。但用户 UI 体验会断裂。

**状态：⚠️ 无持久化（MVP 可接受，生产需改）**

---

## 总结

### 已修复（✅ FIXED）

| # | 问题 | 修复方案 | 文件 |
|---|------|----------|------|
| 1 | StopOrderCallback 余额不足时 revert 而非 graceful fail | 添加 `balanceOf` 检查 + SafeERC20 + try-catch swap（失败退还 token） | `StopOrderCallback.sol` |
| 2 | 滑点硬编码 0.5%，极端行情必失败 | 改为构造函数参数 `slippageBps`（0-1000 bps），可通过 `setSlippage()` 调整 | `StopOrderCallback.sol` |
| 3 | cancel_order revoke allowance 影响所有订单 | 优先使用 `OrderRegistry.cancelOrder()` 取消特定 orderId；fallback 时减少而非清零 allowance | `executor.ts` + `config.ts` |

### 需要注意但 MVP 可接受（⚠️）

| # | 问题 | 建议 |
|---|------|------|
| 1 | 无 TWAP / 价格异常检测 | 文档声明风险 |
| 2 | Base callback 无重试逻辑 | 参考 Arbitrum 版实现 |
| 3 | Reactive Network 离线时事件可能丢失 | 文档声明依赖 |
| 4 | AI 参数无 off-chain 预检 | 添加 executor 层校验 |
| 5 | Event indexer 内存状态无持久化 | 添加文件/DB 持久化 |
| 6 | 无部分成交降级 | 考虑 try-catch + 减量重试 |

### 已正确处理（✅）

| # | 场景 | 防护机制 |
|---|------|----------|
| 1 | 价格恰好等于阈值 | `<=` / `>=` 操作符 |
| 2 | 价格跳过阈值 | Sync 反映最终状态 |
| 3 | OCO 同时触发 | OrderRegistry.linkedOrderId |
| 4 | 闪崩重复执行 | triggered flag 单次保护 |
| 5 | Reactive→Base 延迟 | 双重价格验证 |
| 6 | 用户 revoke 授权 | allowance 实时检查 |
| 7 | Chain reorg | OrderRegistry 幂等 |
| 8 | Reactive 竞态 | VM 顺序执行 |
| 9 | Gas limit | 1M gas，3x 余量 |
| 10 | Session expiry 边界 | strict `<` 比较 |
| 11 | Memory vs 链上状态 | 链上数据优先 |
