export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_results?: ToolResult[]
  timestamp: number
}

export interface ToolResult {
  tool: string
  args: Record<string, unknown>
  result: unknown
}

export interface Portfolio {
  address: string
  weth: { balance: string; formatted: string }
  usdc: { balance: string; formatted: string }
  eth: { balance: string; formatted: string }
  price: number
  totalValueUSD: string
}

export interface Signal {
  timestamp: string
  macro_risk_score: number
  crypto_sentiment: number
  alerts: Array<{
    level: 'FLASH' | 'PRIORITY' | 'ROUTINE'
    signal: string
    relevance: number
  }>
  technical_bias: string
  recommended_action: string
}
