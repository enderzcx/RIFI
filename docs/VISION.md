# RIFI — AI Native Reactive Wallet

> The wallet that trades for you. On-chain. Trustless. Reactive.

---

## Vision

RIFI is not a trading bot — it's an **AI-native wallet app** where users talk to their money.

Traditional wallets: connect → approve → sign → wait → check.
RIFI: **"Buy ETH if it dips below $1,900 and set a stop-loss at $1,800"** → done.

The AI handles execution. Reactive Smart Contracts handle protection. The user just decides.

---

## Core Differentiators

| Feature | Traditional Wallet | RIFI |
|---------|-------------------|------|
| Interaction | Buttons + forms | Natural language chat |
| Trade execution | Manual approve + sign | Session Key auto-execute |
| Stop-loss / Take-profit | None (use CEX) | On-chain via Reactive Network (24/7, no backend) |
| Cross-chain | Bridge manually | "Swap my USDC to BNB chain" (LiFi) |
| Risk management | None | AI hooks: amount limits, balance guards, cooldowns |
| Memory | None | AI remembers your preferences, risk tolerance, patterns |
| Multi-chain | One chain at a time | Base + BSC + ETH (expanding) |

---

## Product Roadmap

### Phase 1: AI Chat Wallet (Current — V3)
- [x] Chat-based DeFi interaction (18 tools)
- [x] Session Key: budget-constrained auto-trading
- [x] Reactive SL/TP: on-chain, decentralized, no backend dependency
- [x] Pre/post trade hooks (safety layer)
- [x] 7-section AI memory (learns your style)
- [x] Portfolio + orders + dashboard
- [ ] Mobile-responsive UI polish
- [ ] Onboarding flow for new users

### Phase 2: Multi-Chain Reactive Wallet
- [ ] BSC chain: Reactive SL/TP for PancakeSwap pairs
- [ ] BSC chain: Meme coin scanner + auto-snipe
- [ ] Arbitrum/Optimism support
- [ ] Unified portfolio across chains
- [ ] Cross-chain SL/TP (set on Base, execute on BSC)
- [ ] Token discovery: trending tokens with AI risk scoring

### Phase 3: Wallet App
- [ ] Mobile app (React Native or PWA)
- [ ] Push notifications: "Your stop-loss triggered, sold 0.05 ETH → $105 USDC"
- [ ] Social login (Privy / Web3Auth) — no MetaMask needed
- [ ] Fiat on-ramp integration
- [ ] Strategy marketplace: share/copy AI trading strategies
- [ ] Multi-wallet management

### Phase 4: Protocol
- [ ] RIFI token: governance + fee discount
- [ ] Revenue model: 0.1% fee on Session Key trades
- [ ] Reactive order fee: small fee per SL/TP deployment
- [ ] DAO governance for protocol parameters
- [ ] Open API for third-party integration

---

## Technical Architecture

```
User (Mobile / Browser)
    │
    ▼
RIFI App (Next.js / React Native)
    │
    ├── Chat AI (18 tools, natural language)
    ├── Session Key (budget-constrained auto-trading)
    ├── Portfolio (multi-chain balances)
    └── Order Management (SL/TP status)
    │
    ▼
┌─────────────────────────────────────────┐
│           On-Chain Layer                 │
│                                          │
│  Base (8453)         BSC (56)           │
│  ├── SessionManagerV2  ├── SessionMgr   │
│  ├── Uniswap V2        ├── PancakeSwap  │
│  ├── StopOrderCallback  ├── StopCallback│
│  └── OrderRegistry      └── OrderReg   │
│                                          │
│  Reactive Network (1597)                │
│  └── PairOrderManager (monitors any     │
│      chain's DEX events, triggers       │
│      callbacks when conditions met)     │
└─────────────────────────────────────────┘
```

---

## Target Users

1. **DeFi beginners** — want to trade but scared of DEX complexity
2. **Active traders** — want automated SL/TP without trusting CEX
3. **Multi-chain users** — want one interface for all chains
4. **AI enthusiasts** — want to talk to their wallet, not click buttons

---

## Success Metrics

- Users with active Session Keys (auto-trading enabled)
- Reactive SL/TP orders deployed (on-chain protection)
- Daily active conversations
- Cross-chain swaps executed
- User retention (30-day)

---

## Competitive Landscape

| Product | What | Missing |
|---------|------|---------|
| MetaMask | Wallet + swap | No AI, no SL/TP, no chat |
| Rabby | Better UX wallet | No AI, no automation |
| 1inch | DEX aggregator | No wallet, no SL/TP |
| Banana Gun | Sniper bot | No wallet, Telegram only |
| RIFI | AI wallet + on-chain SL/TP + session keys | Building |

**RIFI's moat**: Reactive Smart Contracts for decentralized SL/TP. No other wallet has this.
