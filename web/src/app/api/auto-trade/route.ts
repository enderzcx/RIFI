// Event-driven auto-trade endpoint
// VPS calls this when push_worthy signal detected
import { NextRequest } from 'next/server'
import { llm, MODEL } from '@/lib/llm/client'
import { tools } from '@/lib/llm/tools'
import { executeTool } from '@/lib/llm/executor'
import { pushService } from '@/lib/sse/push-service'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const AUTO_TRADE_SECRET = process.env.AUTO_TRADE_SECRET || 'rifi-auto-2026'

const SYSTEM = `你是 RIFI 自动交易引擎。收到高价值信号后自主决策。

规则：
1. 先调 get_session 检查 session 是否 active 且有余额
2. 调 get_market_signals 获取完整信号
3. 调 get_price 获取当前价格
4. 调 get_portfolio 获取持仓
5. 综合分析，决定：交易 / 设止损 / 忽略
6. 交易用 session_swap（不是 market_swap），这样走 SessionManager 链上约束
7. 交易后考虑是否设止损
8. 输出结构化决策理由（中文）

风控：
- confidence < 60 不交易
- 单笔不超过 session maxPerTrade
- 已有同方向持仓时谨慎加仓
- 市场极端波动时优先设止损而非开新仓`

export async function POST(req: NextRequest) {
  // Verify caller
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${AUTO_TRADE_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const signal = body.signal || body

  // Build trigger message
  const triggerMsg = `[AUTO-TRADE TRIGGER] 收到高价值信号：
${JSON.stringify(signal, null, 2)}

请按规则执行自动交易决策流程。`

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: triggerMsg },
  ]

  const decisions: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = []

  // Tool calling loop
  for (let round = 0; round < 8; round++) {
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    })

    const message = response.choices[0].message
    messages.push(message)

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Done — push result to frontend
      const content = message.content || ''

      pushService.broadcastAll({
        type: 'SIGNAL_ALERT',
        level: 'HIGH',
        data: {
          trigger: signal.push_reason || 'High-value signal detected',
          decision: content,
          decisions,
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      })

      return Response.json({
        status: 'completed',
        decision: content,
        tool_calls: decisions.length,
      })
    }

    // Execute tools
    for (const tc of message.tool_calls) {
      const fn = tc as { id: string; function: { name: string; arguments: string } }
      const args = JSON.parse(fn.function.arguments || '{}')
      const result = await executeTool(fn.function.name, args)

      decisions.push({ tool: fn.function.name, args, result: JSON.parse(result) })

      messages.push({
        role: 'tool',
        tool_call_id: fn.id,
        content: result,
      })
    }
  }

  return Response.json({ status: 'max_rounds', decisions: decisions.length })
}
