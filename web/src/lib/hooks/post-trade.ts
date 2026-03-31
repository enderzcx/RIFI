// Post-trade hooks: record, broadcast, audit after execution

import { registerHook } from './registry'
import { recordTradeTimestamp } from './pre-trade'
import type { PostTradeContext, HookResult } from './types'

// --- 1. Record cooldown timestamp ---
registerHook({
  name: 'record-cooldown',
  phase: 'post-trade',
  priority: 10,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PostTradeContext
    const { tool, args, wallet, success } = c

    if (!success) return { allow: true }

    if (tool === 'market_swap' || tool === 'session_swap') {
      recordTradeTimestamp(wallet, args.direction as string)
    }

    return { allow: true }
  },
})

// --- 2. Execution time monitor ---
registerHook({
  name: 'execution-monitor',
  phase: 'post-trade',
  priority: 20,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PostTradeContext
    const { tool, executionTimeMs } = c

    if (executionTimeMs > 15_000) {
      return {
        allow: true,
        reason: `${tool} took ${(executionTimeMs / 1000).toFixed(1)}s — possible RPC congestion`,
        severity: 'warn',
      }
    }

    return { allow: true }
  },
})

// --- 3. Trade failure logger ---
registerHook({
  name: 'failure-logger',
  phase: 'post-trade',
  priority: 30,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PostTradeContext
    const { tool, args, result, success, wallet } = c

    if (!success) {
      const errorMsg = result.error || 'unknown error'
      console.error(`[Hook:failure-logger] ${tool} FAILED for ${wallet}: ${errorMsg}`, { args })
      return {
        allow: true,
        reason: `Trade failed: ${errorMsg}`,
        severity: 'warn',
      }
    }

    return { allow: true }
  },
})

// --- 4. Audit trail ---
registerHook({
  name: 'audit-trail',
  phase: 'post-trade',
  priority: 40,
  enabled: true,
  async run(ctx): Promise<HookResult> {
    const c = ctx as PostTradeContext
    const { tool, args, result, wallet, executionTimeMs, success } = c

    // Structured audit log — parseable by external systems
    console.log(JSON.stringify({
      _type: 'trade_audit',
      ts: new Date().toISOString(),
      tool,
      wallet: wallet.slice(0, 10) + '...',
      args,
      success,
      txHash: result.txHash || result.tx_hash || null,
      executionTimeMs,
    }))

    return { allow: true }
  },
})
