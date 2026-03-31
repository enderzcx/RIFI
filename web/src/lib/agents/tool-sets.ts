// Per-agent tool subsets — each agent only sees the tools it needs

import { tools as allTools } from '@/lib/llm/tools'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

function pickTools(names: string[]): ChatCompletionTool[] {
  return allTools.filter(t => 'function' in t && names.includes(t.function.name))
}

// Analyst: read-only data gathering, NO trading
export const ANALYST_TOOLS = pickTools([
  'get_market_signals',
  'get_price',
  'get_portfolio',
  'get_crypto_news',
  'get_crucix_data',
  'get_onchain_data',
])

// Strategist: read-only + session info + orders, NO trading
export const STRATEGIST_TOOLS = pickTools([
  'get_price',
  'get_portfolio',
  'get_session',
  'get_active_orders',
])

// Executor: trading tools only (data already provided via scratchpad)
export const EXECUTOR_TOOLS = pickTools([
  'get_price',
  'get_portfolio',
  'get_session',
  'session_swap',
  'set_stop_loss',
  'set_take_profit',
])
