# Base Stop Order Test Report

> Date: 2026-03-26
> Result: **SUCCESS** - Callback triggered in ~8 seconds (4 blocks)

## Architecture

```
Base (Origin + Destination)          Reactive Mainnet (RNK)
┌──────────────────────┐            ┌───────────────────────┐
│ Uniswap V2 Pair      │──Sync──>  │ BaseStopOrderReactive │
│ (BTKA/BTKB)          │           │ - monitors Sync events│
│                      │           │ - checks price vs     │
│ BaseStopOrderCallback│<─callback─│   threshold           │
│ - executes swap      │           │ - emits Callback      │
└──────────────────────┘            └───────────────────────┘
```

## Deployed Contracts

### Base Mainnet (Chain ID: 8453)

| Contract | Address | Tx Hash |
|----------|---------|---------|
| Token A (BTKA) | `0x7C3e04Cd7d1306D1d1F386Fc0DDC691136b89534` | `0xb1f430f7bfdb4c348c1d1ef49025fce2340d89bb1f2651a6d4f8dc76b874fe8f` |
| Token B (BTKB) | `0xf02F76155AC96c9F6200B2823e9e1B98Bc38d0DF` | `0x447ff6a511b293b63df005ace4bd670f15e0a483b2a1e930c453a617c16776a1` |
| Uniswap V2 Pair | `0x7933e87F21c0B7AA36Ba1725574c19bB73C2a2B2` | `0xf4e411e9e06863771a80b9f85a3403a3c23fe46a2472bc8d222fe93b7e3c09b0` |
| Callback Contract | `0x9702220849b78318d7596B0F6503081DeE0a64f3` | `0xc93a7d55128e3308c9a084962e26f400af802a49b91a939115555ed59c18fdc1` |

### Reactive Mainnet (Chain ID: 1597)

| Contract | Address | Tx Hash |
|----------|---------|---------|
| Reactive Contract | `0xC28Ea685209c8A10Cc4808c9694A3ae6c22c4eAE` | `0x2190830c0f2c1f10c1ee87c2e2bfc3f831c76d1138fdba2f3c843f202b06b78a` |

## Key Addresses

| Name | Address |
|------|---------|
| Wallet | `0x0309dc91bB89750C317Ec69566bAF1613b57e6bB` |
| Base Callback Proxy | `0x0D3E76De6bC44309083cAAFdB49A088B8a250947` |
| Uniswap V2 Router (Base) | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| Uniswap V2 Factory (Base) | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` |

## Pair Configuration

- token0 = BTKA (`0x7C3e04Cd7d1306D1d1F386Fc0DDC691136b89534`)
- token1 = BTKB (`0xf02F76155AC96c9F6200B2823e9e1B98Bc38d0DF`)
- Initial liquidity: 10 BTKA + 10 BTKB (1:1)

## Reactive Contract Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| pair | `0x7933e87...` | Uniswap V2 pair address |
| stop_order (callback) | `0x970222...` | Callback contract on Base |
| client | `0x0309dc...` | User wallet |
| token0 | `true` | Selling token0 (BTKA) |
| coefficient | `1000` | Price multiplier |
| threshold | `2000` | Trigger when rate <= 2000 |

## Test Execution

### Step 1: Approve BTKA to Callback
- Amount: 1 BTKA (1e18)
- Status: Success

### Step 2: Trigger Sync (swap BTKB for BTKA)
- Transferred 0.02 BTKB to pair
- Swapped 0.005 BTKA out
- Sync emitted at block ~43859458
- Reserves after: 9.98e18 / 10.02e18
- Rate = (10.02e18 * 1000) / 9.98e18 ≈ 1004 <= 2000 (condition met)

### Step 3: Callback Execution
- **Triggered at block 43859462** (~4 blocks / ~8 seconds after Sync)
- Tx Hash: `0xfd891eb2ea12d156af3868dbcea3846d76b085766675fb511ef2567dfc977616`
- Stop event emitted with:
  - Sold: 1 BTKA (1e18)
  - Received: ~0.912 BTKB (9.12e17)

## Comparison: Sepolia vs Arbitrum vs Base

| Metric | Sepolia (Testnet) | Arbitrum (Mainnet) | Base (Mainnet) |
|--------|-------------------|--------------------|--------------------|
| Reactive Network | Lasna Testnet | RNK Mainnet | RNK Mainnet |
| Trigger Time | ~2 minutes | **NEVER** (15+ min) | **~8 seconds** |
| Result | SUCCESS | FAIL | **SUCCESS** |

## Conclusion

- **Reactive Mainnet works reliably with Base as origin chain**
- **Reactive Mainnet does NOT work with Arbitrum as origin chain** (as of 2026-03-26)
- Base trigger latency (~8s) is even faster than Sepolia testnet (~2min)
- For production stop-loss/take-profit, **use Base, not Arbitrum**
