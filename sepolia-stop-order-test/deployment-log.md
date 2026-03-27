# Sepolia Stop Order Test - Full Deployment Log

> Date: 2026-03-26
> Network: Ethereum Sepolia + Reactive Lasna (testnet)
> Result: SUCCESS - stop order triggered and executed

---

## Network Info

| Item | Value |
|------|-------|
| Origin/Destination Chain | Ethereum Sepolia (Chain ID: 11155111) |
| Reactive Chain | Reactive Lasna (Chain ID: 5318007) |
| Sepolia RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| Lasna RPC | `https://lasna-rpc.rnk.dev/` |
| Sepolia Callback Proxy | `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA` |
| Uniswap V2 Router (Sepolia) | `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` |
| Uniswap V2 Factory (Sepolia) | `0x7E0987E5b3a30e3f2828572Bb659A548460a3003` |

## Wallet

| Item | Value |
|------|-------|
| Address | `0xeaBe63116b6d5A3510c2F101A97E67136a821Be5` |
| Sepolia ETH (before) | 0.002984 ETH |
| Lasna REACT (before) | 0.2828 REACT |

---

## Step 1: Deploy Test Tokens

### Token A (TKA)
- **Contract**: `0x40f8785DEB9A5e6Eee793aCC9B9F7416B4fa2442`
- **Tx**: `0x347c4fa1c9d2e9b53ea3019946aa0fec6a9d7b27b9da3e86abda45cfdc73b804`
- **Explorer**: https://sepolia.etherscan.io/tx/0x347c4fa1c9d2e9b53ea3019946aa0fec6a9d7b27b9da3e86abda45cfdc73b804

### Token B (TKB)
- **Contract**: `0xC8137Dfdc630fe7770A2Fc7A8c784833eea6552f`
- **Tx**: `0x17d96030839e5204622969040679cb9e58723bbeb25fae480334a7db21fcd218`
- **Explorer**: https://sepolia.etherscan.io/tx/0x17d96030839e5204622969040679cb9e58723bbeb25fae480334a7db21fcd218

Both tokens: ERC-20, 18 decimals, 100 tokens minted to deployer.

```bash
forge create --broadcast --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY \
  UniswapDemoToken.sol:UniswapDemoToken --constructor-args "TokenA" "TKA"
```

---

## Step 2: Create Uniswap V2 Pair

- **Pair**: `0xC749aBC017FE4802e63a8b71885C12Cb49Ca51a6`
- **Tx**: `0xaf66621a451873a886e84690842632e5a087fd373dd293b0404fd9bf7b3c1ee9`
- **Explorer**: https://sepolia.etherscan.io/tx/0xaf66621a451873a886e84690842632e5a087fd373dd293b0404fd9bf7b3c1ee9
- **token0** = TKA (`0x40f8...2442`)
- **token1** = TKB (`0xC813...552f`)

```bash
cast send 0x7E0987E5b3a30e3f2828572Bb659A548460a3003 \
  'createPair(address,address)' $TKA $TKB \
  --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY
```

---

## Step 3: Add Liquidity (10 TKA + 10 TKB)

Transferred 10 tokens of each to the pair, then minted LP tokens.

- Initial Reserves: `10e18 : 10e18` (1:1 ratio)

```bash
cast send $TKA 'transfer(address,uint256)' $PAIR 10000000000000000000
cast send $TKB 'transfer(address,uint256)' $PAIR 10000000000000000000
cast send $PAIR 'mint(address)' $WALLET
```

---

## Step 4: Deploy Callback Contract (Sepolia)

- **Contract**: `0xe6851CDd99929276D87169cB38a26337b99491AC`
- **Tx**: `0x63f46741fdcdc2390b5c0d649c35167b911e0b939844c6628a95298f972bae0b`
- **Explorer**: https://sepolia.etherscan.io/address/0xe6851CDd99929276D87169cB38a26337b99491AC
- **Value**: 0.001 ETH (deposit for callback proxy gas)

```bash
forge create --broadcast --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY \
  UniswapDemoStopOrderCallback.sol:UniswapDemoStopOrderCallback \
  --value 0.001ether \
  --constructor-args $SEPOLIA_CALLBACK_PROXY $ROUTER
```

Constructor args:
- `_callback_sender`: `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA` (Sepolia Callback Proxy)
- `_router`: `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` (Uniswap V2 Router)

---

## Step 5: Deploy Reactive Contract (Lasna)

- **Contract**: `0xe1953189aA3909e85EC3fEbd7aa1AD5ef0ae3D57`
- **Tx**: `0x5c9b6b60234b695548873111737e45b860d7f7d4cc9f21c89c67b17e41531b41`
- **Value**: 0.1 REACT (for subscriptions + callbacks)

```bash
forge create --broadcast --rpc-url $LASNA_RPC --private-key $PRIVATE_KEY \
  UniswapDemoStopOrderReactive.sol:UniswapDemoStopOrderReactive \
  --value 0.1ether \
  --constructor-args $PAIR $CALLBACK $WALLET true 1000 2000
```

Constructor args:
- `_pair`: `0xC749aBC017FE4802e63a8b71885C12Cb49Ca51a6`
- `_stop_order`: `0xe6851CDd99929276D87169cB38a26337b99491AC`
- `_client`: `0xeaBe63116b6d5A3510c2F101A97E67136a821Be5`
- `_token0`: `true` (sell TKA, buy TKB)
- `_coefficient`: `1000`
- `_threshold`: `2000` (instant trigger: current rate 1000 <= 2000)

Subscriptions created:
1. Sync events from pair on Sepolia (chain 11155111)
2. Stop events from callback on Sepolia (chain 11155111)

---

## Step 6: Approve Token Spending

Approved 1 TKA to callback contract.

```bash
cast send $TKA 'approve(address,uint256)' $CALLBACK 1000000000000000000
```

---

## Step 7: Trigger Stop Order

### 7a. Transfer TKA to pair (0.02 tokens)

```bash
cast send $TKA 'transfer(address,uint256)' $PAIR 20000000000000000
```

### 7b. Execute swap to shift rate + emit Sync

- **Tx**: `0x6f11c03ecdf19ab6014b75e207caed611a0b87b35765f98ac9274881690a1830`
- **Explorer**: https://sepolia.etherscan.io/tx/0x6f11c03ecdf19ab6014b75e207caed611a0b87b35765f98ac9274881690a1830

```bash
cast send $PAIR 'swap(uint256,uint256,address,bytes)' 0 5000000000000000 $WALLET "0x"
```

Post-swap reserves: `10.02 TKA : 9.995 TKB`
Rate check: `(9.995e18 * 1000) / 10.02e18 = 997 <= 2000` -> TRIGGERED

---

## Result: Stop Order Executed

### Callback Transaction (Sepolia)
- **Tx**: `0x114096dcfb745aeda507383fc540d8d53ef42f6ba1152e665ded980fc3f2ad89`
- **Block**: 10523844
- **Explorer**: https://sepolia.etherscan.io/tx/0x114096dcfb745aeda507383fc540d8d53ef42f6ba1152e665ded980fc3f2ad89

### Stop Event
- **Event**: `Stop(address pair, address client, address token, uint256[] tokens)`
- **pair**: `0xC749aBC017FE4802e63a8b71885C12Cb49Ca51a6`
- **client**: `0xeaBe63116b6d5A3510c2F101A97E67136a821Be5`
- **token (sold)**: `0x40f8785DEB9A5e6Eee793aCC9B9F7416B4fa2442` (TKA)
- **tokens[0]** (input): `1000000000000000000` (1 TKA)
- **tokens[1]** (output): `904625697166488089` (~0.905 TKB)

### Final Token Balances
- TKA: 89 tokens (100 - 10 liquidity - 1 sold)
- TKB: 90.91 tokens (90 + 0.905 from swap + 0.005 from direct swap)

---

## Timeline

| Time | Event |
|------|-------|
| ~14:03 | Deploy Token A & B |
| ~14:05 | Create pair + add liquidity |
| ~14:08 | Deploy callback (Sepolia) |
| ~14:10 | Deploy reactive (Lasna) |
| ~14:12 | Approve TKA + trigger swap (Sync emitted) |
| ~14:15 | Callback received, stop order executed |

**Total time from Sync to execution: ~3 minutes** (Lasna testnet)

---

## Addresses Summary

| Contract | Chain | Address |
|----------|-------|---------|
| Token A (TKA) | Sepolia | `0x40f8785DEB9A5e6Eee793aCC9B9F7416B4fa2442` |
| Token B (TKB) | Sepolia | `0xC8137Dfdc630fe7770A2Fc7A8c784833eea6552f` |
| Uniswap V2 Pair | Sepolia | `0xC749aBC017FE4802e63a8b71885C12Cb49Ca51a6` |
| Callback | Sepolia | `0xe6851CDd99929276D87169cB38a26337b99491AC` |
| Reactive | Lasna | `0xe1953189aA3909e85EC3fEbd7aa1AD5ef0ae3D57` |

---

## Key Findings

1. **Reactive Lasna (testnet) works well** - events are picked up and callbacks delivered within ~3 minutes
2. **Reactive Mainnet + Arbitrum has issues** - event indexing appears delayed/broken (tested same day, no callbacks after 10+ minutes)
3. **Simple demo is one-shot** - the reactive contract sets `triggered = true` after first execution, won't fire again
4. **For production use**: need the enhanced version (uniswap-v2-stop-take-profit-order) which supports multiple dynamic orders, retry logic, and re-triggering

## Source Files

- `UniswapDemoToken.sol` - ERC-20 test token (100 tokens minted to deployer)
- `UniswapDemoStopOrderCallback.sol` - Destination chain callback (executes swap via Uniswap Router)
- `UniswapDemoStopOrderReactive.sol` - Reactive contract (monitors Sync, triggers callback when threshold met)
