// Multi-agent coordinator types

import type { ChatCompletionTool } from 'openai/resources/chat/completions'

export type AgentRole = 'analyst' | 'strategist' | 'executor'

export interface AgentResult {
  role: AgentRole
  content: string                         // final text output
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result: unknown
  }>
  durationMs: number
  rounds: number
}

export interface AgentConfig {
  role: AgentRole
  systemPrompt: string
  tools: ChatCompletionTool[]             // restricted tool subset
  maxRounds: number
}

// Shared context passed between agents in a coordinator run
export interface Scratchpad {
  signal: Record<string, unknown>          // original VPS signal
  traceId: string
  analystVerdict?: {
    action: string                         // strong_buy / hold / reduce_exposure / etc.
    confidence: number
    briefing: string
    riskScore: number
  }
  strategistPlan?: {
    direction: 'buy' | 'sell' | 'hold'
    amount: string
    reason: string
    stopLoss?: number
    takeProfit?: number
  }
  executorResult?: {
    traded: boolean
    txHash?: string
    summary: string
  }
  decisions: Array<{ agent: AgentRole; tool: string; args: Record<string, unknown>; result: unknown }>
}
