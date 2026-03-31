// Pre-trade hooks: validate before any write operation hits the chain

import { registerHook } from './registry'
import { RISK_CONFIG } from './risk-config'
import type { PreTradeContext, HookResult } from './types'

// --- Track recent trades for cooldown ---
const recentTrades = new Map<string, number>() // wallet -> last trade timestamp
const recentDirections = new Map<string, number>() // wallet:direction -> last timestamp

// Prune expired entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  const maxAge = RISK_CONFIG.samePairCooldownMs * 2
  for (const [key, ts] of recentTrades) {
    if (now - ts > maxAge) recentTrades.delete(key)
  }
  for (const [key, ts] of recentDirections) {
    if (now - ts > maxAge) recentDirections.delete(key)
  }
}, 300_000)

// --- 1. Amount Limit Check ---
registerHook({
  name: 'amount-limit',
  phase: 'pre-trade',
  priority: 10,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PreTradeContext
    const { tool, args } = c

    if (tool === 'market_swap' || tool === 'session_swap') {
      const amt = parseFloat(args.amount as string)
      const dir = args.direction as string

      if (dir === 'sell' && amt > RISK_CONFIG.maxSwapWeth) {
        return { allow: false, reason: `Sell amount ${amt} WETH exceeds limit ${RISK_CONFIG.maxSwapWeth}`, severity: 'block' }
      }
      if (dir === 'buy' && amt > RISK_CONFIG.maxSwapUsdc) {
        return { allow: false, reason: `Buy amount ${amt} USDC exceeds limit ${RISK_CONFIG.maxSwapUsdc}`, severity: 'block' }
      }
    }

    if ((tool === 'set_stop_loss' || tool === 'set_take_profit')) {
      const amt = parseFloat(args.amount as string)
      if (amt > RISK_CONFIG.maxStopLossWeth) {
        return { allow: false, reason: `SL/TP amount ${amt} WETH exceeds limit ${RISK_CONFIG.maxStopLossWeth}`, severity: 'block' }
      }
    }

    return { allow: true }
  },
})

// --- 2. Balance Guard ---
registerHook({
  name: 'balance-guard',
  phase: 'pre-trade',
  priority: 20,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PreTradeContext
    const { tool, args, portfolio } = c

    // Skip if portfolio not available (read-only tools fetch it separately)
    if (!portfolio) return { allow: true }

    if (tool === 'market_swap' || tool === 'session_swap') {
      const amt = parseFloat(args.amount as string)
      const dir = args.direction as string

      if (dir === 'sell') {
        const remaining = portfolio.weth - amt
        if (remaining < RISK_CONFIG.minWethReserve) {
          return { allow: false, reason: `Selling ${amt} WETH would leave ${remaining.toFixed(6)} (min reserve: ${RISK_CONFIG.minWethReserve})`, severity: 'block' }
        }
      }

      if (dir === 'buy') {
        const remaining = portfolio.usdc - amt
        if (remaining < RISK_CONFIG.minUsdcReserve) {
          return { allow: false, reason: `Buying with ${amt} USDC would leave ${remaining.toFixed(2)} (min reserve: ${RISK_CONFIG.minUsdcReserve})`, severity: 'block' }
        }
      }
    }

    // Gas guard for all write operations
    if (portfolio.eth < RISK_CONFIG.minEthForGas) {
      return { allow: false, reason: `ETH balance ${portfolio.eth.toFixed(6)} too low for gas (min: ${RISK_CONFIG.minEthForGas})`, severity: 'block' }
    }

    return { allow: true }
  },
})

// --- 3. Cooldown ---
registerHook({
  name: 'cooldown',
  phase: 'pre-trade',
  priority: 30,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PreTradeContext
    const { tool, args, wallet } = c

    if (tool !== 'market_swap' && tool !== 'session_swap') return { allow: true }

    const now = Date.now()
    const lastTrade = recentTrades.get(wallet.toLowerCase())
    if (lastTrade && now - lastTrade < RISK_CONFIG.tradeCooldownMs) {
      const waitSec = Math.ceil((RISK_CONFIG.tradeCooldownMs - (now - lastTrade)) / 1000)
      return { allow: false, reason: `Trade cooldown: wait ${waitSec}s`, severity: 'block' }
    }

    // Same direction cooldown
    const dir = args.direction as string
    const dirKey = `${wallet.toLowerCase()}:${dir}`
    const lastDir = recentDirections.get(dirKey)
    if (lastDir && now - lastDir < RISK_CONFIG.samePairCooldownMs) {
      const waitSec = Math.ceil((RISK_CONFIG.samePairCooldownMs - (now - lastDir)) / 1000)
      return { allow: false, reason: `Same-direction cooldown: wait ${waitSec}s before another ${dir}`, severity: 'block' }
    }

    return { allow: true }
  },
})

// --- 4. Session Budget Warning ---
registerHook({
  name: 'session-budget-warn',
  phase: 'pre-trade',
  priority: 40,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PreTradeContext
    const { tool, session } = c

    if (tool !== 'session_swap') return { allow: true }
    if (!session || !session.active) return { allow: true }

    const remaining = parseFloat(session.remaining)
    const maxPerTrade = parseFloat(session.maxPerTrade)
    const totalBudget = remaining + maxPerTrade // approximate: remaining is what's left

    if (totalBudget > 0 && remaining / totalBudget < (1 - RISK_CONFIG.sessionBudgetWarnPct)) {
      return { allow: true, reason: `Session budget ${(remaining / totalBudget * 100).toFixed(0)}% remaining`, severity: 'warn' }
    }

    return { allow: true }
  },
})

// Export for cooldown tracking from post-trade
export function recordTradeTimestamp(wallet: string, direction?: string) {
  const now = Date.now()
  recentTrades.set(wallet.toLowerCase(), now)
  if (direction) {
    recentDirections.set(`${wallet.toLowerCase()}:${direction}`, now)
  }
}
