// Hook registry: register, run, and manage trade lifecycle hooks

import type { HookDef, HookPhase, HookResult, PreTradeContext, PostTradeContext } from './types'

const hooks: HookDef[] = []

export function registerHook(hook: HookDef) {
  hooks.push(hook)
  // Keep sorted by priority (lower first)
  hooks.sort((a, b) => a.priority - b.priority)
}

export function getHooks(phase: HookPhase): HookDef[] {
  return hooks.filter(h => h.phase === phase && h.enabled)
}

/**
 * Run all hooks for a given phase. Returns the first blocking result, or { allow: true }.
 * For post-trade hooks, all run regardless (no short-circuit).
 */
export async function runHooks(
  phase: 'pre-trade',
  ctx: PreTradeContext
): Promise<HookResult>
export async function runHooks(
  phase: 'post-trade',
  ctx: PostTradeContext
): Promise<HookResult>
export async function runHooks(
  phase: HookPhase,
  ctx: PreTradeContext | PostTradeContext
): Promise<HookResult> {
  const active = getHooks(phase)
  const results: Array<{ hook: string; result: HookResult }> = []

  for (const hook of active) {
    try {
      const result = await hook.run(ctx)
      results.push({ hook: hook.name, result })

      // Pre-trade: short-circuit on block
      if (phase === 'pre-trade' && !result.allow) {
        console.log(`[Hook] ${hook.name} BLOCKED: ${result.reason}`)
        return result
      }

      // Log warnings
      if (result.severity === 'warn') {
        console.log(`[Hook] ${hook.name} WARN: ${result.reason}`)
      }
    } catch (err) {
      // Hook errors should never break trading - log and continue
      console.error(`[Hook] ${hook.name} ERROR:`, err)
    }
  }

  return { allow: true }
}

// Which tools are "write" operations that need hooks
const WRITE_TOOLS = new Set([
  'market_swap',
  'session_swap',
  'set_stop_loss',
  'set_take_profit',
  'cancel_order',
  'lifi_swap',
  'bitget_trade',
])

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName)
}
