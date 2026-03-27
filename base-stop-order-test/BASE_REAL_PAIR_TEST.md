# Base 真实池子止损测试（WETH/USDC Uniswap V2）

## 测试目标
监控 Base 链上高流动性真实池子（WETH/USDC），由自然市场交易触发 Sync 事件，验证 Reactive Network 能否自动执行止损回调。

## 合约地址

| 合约 | 地址 | 链 |
|------|------|-----|
| Callback | `0x9702220849b78318d7596B0F6503081DeE0a64f3` | Base (8453) |
| Reactive | `0xbCee0509254E6bcF6F6922Ba425c59acb14b27E0` | Reactive Mainnet (1597) |
| Uniswap V2 WETH/USDC Pair | `0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C` | Base (8453) |
| WETH | `0x4200000000000000000000000000000000000006` | Base |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base |
| Callback Proxy | `0x0D3E76De6bC44309083cAAFdB49A088B8a250947` | Base |

## 参数

- **pair**: WETH/USDC (token0=WETH, token1=USDC)
- **sellToken0**: true (卖 WETH 换 USDC)
- **coefficient**: 1000000000000 (1e12，补偿 USDC 6位 vs WETH 18位小数差)
- **threshold**: 2120 (当前价格 ≈ 2118，设置略高于当前价格以便快速触发)
- **amount**: 0.001 WETH (通过 allowance 控制)

## 执行结果

### 触发交易
- **TX Hash**: `0x600e7eaadc7034283067171ee3d41fdd55fe9ec2153ed1c2a9276f5098107661`
- **Block**: 43860043
- **Status**: SUCCESS
- **Gas Used**: 231,695
- **From**: `0x777f67156e2bb3ee9CEA6866C2656b099b67D132` (Callback Proxy sender)
- **To**: `0x0D3E76De6bC44309083cAAFdB49A088B8a250947` (Callback Proxy)

### 交易流程（9个事件）
1. **Transfer**: WETH 从用户钱包 → Callback 合约 (0.001 WETH)
2. **Approval**: Callback 合约授权 Uniswap Router 使用 WETH
3. **Transfer**: WETH 从 Callback → Uniswap Pair
4. **Transfer**: USDC 从 Uniswap Pair → Callback
5. **Sync**: 池子储备更新
6. **Swap**: Uniswap swap 事件
7. **Transfer**: USDC 从 Callback → 用户钱包 (**2.112007 USDC**)
8. **Stop**: Callback 止损完成事件
9. **CallbackExecuted**: Callback Proxy 确认

### 最终余额变化
- WETH: 0.001 → 0 (已全部卖出)
- USDC: 0 → 2.112007 (收到)

## 关键发现

### 触发速度
由自然市场交易的 Sync 事件触发，无需手动干预。触发速度快。

### 跨链对比

| 链 | 结果 | 延迟 |
|---|---|---|
| Sepolia (测试网) | 成功 | ~2分钟 |
| Base (主网) | 成功 | 快速触发 |
| Arbitrum (主网) | 失败 | 15分钟+ 未触发 |

### 结论
- **Base 是 Reactive Mainnet 支持最好的主网链之一**
- Arbitrum 的 origin 支持存在问题
- 实际生产环境应优先选择 Base 链
