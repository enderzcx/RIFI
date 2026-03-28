# RIFI — Reactive Intelligence for Financial Instruments

> **AI decides. Reactive executes.**

AI-native autonomous trading agent on Base. Features **Sentinel Mode** — a 24/7 autonomous agent that monitors 27+ data sources and executes on-chain. Stop-loss and take-profit orders run on Reactive Network: even if the frontend goes offline, your orders keep executing.

---

## Problem

Traditional DEX stop-loss requires a centralized backend to monitor prices. If the server goes down, your orders don't execute.

**Reactive Smart Contracts fix this.** They subscribe to on-chain events across chains and autonomously trigger callbacks — no backend, no keeper, no bot required.

- **Base (8453):** User tokens, Uniswap liquidity, callback execution
- **Reactive Network (1597):** Price-watching contract, listens to Base Sync events forever

---

## How It Works

### Sentinel Mode (Autonomous)

```
Every 15 min — VPS Intelligence Pipeline
         │
         ├── 27+ sources (FRED/VIX, GDELT, news, Twitter, on-chain)
         └── LLM: analyze → { action, confidence, reason, push_worthy }
                    │
                    │ push_worthy = true?
                    ▼
         POST /api/auto-trade  (Bearer token auth)
         SessionManager.executeSwap()   ← enforces budget on-chain
         Uniswap V2 swap / set_stop_loss()
                    │
                    ▼
         SSE push → Chat displays decision + TX hash
```

### Chat Mode (User-directed)

```
User: "Buy 0.1 ETH, set stop-loss at $2000"
         │
         ▼
   AI (GPT-5.4) calls set_stop_loss(0.1, 2000)
         │
         ├── Approve WETH to StopOrderCallback (Base)
         ├── Register order in OrderRegistry (Base)
         └── Deploy PairOrderManager (Reactive Network)
                    │
                    │ Subscribes to Uniswap WETH/USDC Sync events
                    │ Every swap: "Is price <= $2000?"
                    │
                    └── YES → Callback → StopOrderCallback.execute()
                                              │
                                              ├── Re-verify price on Base
                                              ├── Check balance & allowance
                                              ├── Swap WETH → USDC via Uniswap V2
                                              └── Send USDC to user wallet
```

---

## Deployed Contracts

### Base Mainnet (Chain ID: 8453)

| Contract | Address |
|----------|---------|
| StopOrderCallback | [`0x9702220849b78318d7596B0F6503081DeE0a64f3`](https://basescan.org/address/0x9702220849b78318d7596B0F6503081DeE0a64f3) |
| OrderRegistry | [`0xcE9720Ae1185e8E8c5739A5d3f88D75F3823D698`](https://basescan.org/address/0xcE9720Ae1185e8E8c5739A5d3f88D75F3823D698) |
| SessionManager | [`0x5810d1A3DAEfe21fB266aB00Ec74ca628637550e`](https://basescan.org/address/0x5810d1A3DAEfe21fB266aB00Ec74ca628637550e) |
| Callback Proxy | [`0x0D3E76De6bC44309083cAAFdB49A088B8a250947`](https://basescan.org/address/0x0D3E76De6bC44309083cAAFdB49A088B8a250947) |
| WETH/USDC Pair | `0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C` |

### Reactive Mainnet (Chain ID: 1597)

| Contract | Address |
|----------|---------|
| PairOrderManager | [`0x342168e8D2BF8315BbF72F409A94f1EC7570f611`](https://kopli.reactscan.net/address/0x342168e8D2BF8315BbF72F409A94f1EC7570f611) |

---

## Transaction Proof

### Real WETH/USDC Stop-Loss on Base Mainnet

| Step | Chain | TX |
|------|-------|----|
| Deploy Reactive | RNK (1597) | `0xbCee0509...` subscribed to WETH/USDC Sync events |
| **Stop-loss executed** | Base (8453) | [`0x600e7eaa...`](https://basescan.org/tx/0x600e7eaadc7034283067171ee3d41fdd55fe9ec2153ed1c2a9276f5098107661) |

- Sold 0.001 WETH → 2.112007 USDC, block 43860043, gas 231,695

### End-to-End on Sepolia Testnet

| Step | Chain | TX |
|------|-------|----|
| Deploy Reactive | Lasna (5318007) | [`0x5c9b6b60...`](https://kopli.reactscan.net/tx/0x5c9b6b60234b695548873111737e45b860d7f7d4cc9f21c89c67b17e41531b41) |
| Trigger (price drop) | Sepolia | [`0x6f11c03e...`](https://sepolia.etherscan.io/tx/0x6f11c03ecdf19ab6014b75e207caed611a0b87b35765f98ac9274881690a1830) |
| **Callback executed** | Sepolia | [`0x114096dc...`](https://sepolia.etherscan.io/tx/0x114096dcfb745aeda507383fc540d8d53ef42f6ba1152e665ded980fc3f2ad89) |

---

## Smart Contracts (`src/`)

| File | Purpose |
|------|---------|
| `StopOrderCallback.sol` | Callback executor: double price verification, configurable slippage, graceful balance/allowance failure, try-catch swap with token refund |
| `PairOrderManager.sol` | Reactive contract: subscribes to Uniswap Sync events, manages multi-order state, single-trigger protection |
| `OrderRegistry.sol` | On-chain order ledger, OCO (one-cancels-other) linked orders |
| `SessionVault.sol` | Session key budget enforcement: user grants AI limited trading rights (maxPerTrade, totalBudget, expiry) |
| `ArbitrumStopOrderCallback.sol` | Arbitrum variant with retry logic |
| `ArbitrumStopOrderReactive.sol` | Arbitrum variant reactive monitor |

---

## Deployment

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge install
```

**Step 1 — Deploy on Base:**
```bash
forge script script/DeployBaseStopOrder.s.sol:DeployBase \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --broadcast -vvvv
```

**Step 2 — Deploy on Reactive Mainnet:**
```bash
forge script script/DeployBaseStopOrder.s.sol:DeployReactive \
  --rpc-url $REACTIVE_RPC --private-key $PRIVATE_KEY --broadcast -vvvv
```

**Step 3 — Start Web App:**
```bash
cd web && cp .env.example .env.local && npm install && npm run dev
```

---

## Sentinel Mode

Every 15 minutes, the Sentinel agent:
1. Aggregates 27+ data sources (FRED/VIX, GDELT, crypto news, Twitter sentiment)
2. LLM analyzes and decides — confidence score, action, reason
3. If `push_worthy`: executes autonomously via SessionManager on-chain

User controls: `maxPerTrade`, `totalBudget`, `expiry` — enforced on-chain by SessionManager contract.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React 19, TypeScript, Tailwind CSS |
| Web3 | Wagmi, Viem, ConnectKit |
| AI | OpenAI-compatible LLM (GPT-5.4) |
| Blockchain | Base (8453) + Reactive Network (1597) |
| Contracts | Solidity 0.8+, Foundry, OpenZeppelin |
| Real-time | Server-Sent Events (SSE) |
