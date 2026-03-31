// Hook system entry point — import this to register all hooks and get the runner

export { runHooks, isWriteTool } from './registry'
export type { HookDef, PreTradeContext, PostTradeContext, HookResult, TradeContext } from './types'
export { RISK_CONFIG } from './risk-config'

// Side-effect imports: registering hooks
import './pre-trade'
import './post-trade'
