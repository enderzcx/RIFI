// Hook system types for RIFI trade lifecycle

export type HookPhase = 'pre-trade' | 'post-trade'

export interface TradeContext {
  tool: string                          // tool name: market_swap, session_swap, set_stop_loss, etc.
  args: Record<string, unknown>         // tool arguments
  wallet: string                        // user wallet address
  isServerWallet: boolean               // server wallet = always trusted
  hasSession: boolean                   // has active SessionManager session
  canServerExecute: boolean             // server can execute on behalf
}

export interface PreTradeContext extends TradeContext {
  price?: number                        // current WETH/USDC price (if fetched)
  portfolio?: {                         // wallet balances (if fetched)
    weth: number
    usdc: number
    eth: number
  }
  session?: {                           // session state (if fetched)
    maxPerTrade: string
    remaining: string
    active: boolean
    expired: boolean
  }
}

export interface PostTradeContext extends TradeContext {
  result: Record<string, unknown>       // tool execution result
  executionTimeMs: number               // how long the tool took
  success: boolean                      // did it succeed (no error key)
}

export interface HookResult {
  allow: boolean                        // false = block the trade
  reason?: string                       // human-readable reason (for blocking or logging)
  severity?: 'info' | 'warn' | 'block'  // info = log only, warn = log + alert, block = reject
}

export interface HookDef {
  name: string
  phase: HookPhase
  priority: number                      // lower = runs first (0-100)
  enabled: boolean
  run: (ctx: PreTradeContext | PostTradeContext) => Promise<HookResult>
}
