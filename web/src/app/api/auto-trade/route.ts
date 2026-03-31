// Event-driven auto-trade endpoint — Multi-Agent Coordinator
// VPS calls this when push_worthy signal detected
// Flow: Analyst → Strategist → Executor (each with restricted tools)
import { NextRequest } from 'next/server'
import { runCoordinator } from '@/lib/agents'
import { pushService } from '@/lib/sse/push-service'

const AUTO_TRADE_SECRET = process.env.AUTO_TRADE_SECRET || 'rifi-auto-2026'
const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function POST(req: NextRequest) {
  // Verify caller
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${AUTO_TRADE_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const signal = body.signal || body
  const traceId = body.trace_id || `coord_${Date.now()}`

  console.log(`[AutoTrade:${traceId}] Coordinator start`)

  try {
    const userAddress = (signal.user_address || signal.wallet || undefined) as string | undefined
    const result = await runCoordinator(signal, traceId, userAddress)
    const { status, scratchpad, summary } = result

    // Push to frontend if trade was executed
    if (status === 'traded') {
      const tradeDecisions = scratchpad.decisions.filter(d =>
        ['session_swap', 'market_swap', 'set_stop_loss', 'set_take_profit'].includes(d.tool)
      )
      pushService.broadcastAll({
        type: 'SIGNAL_ALERT',
        level: 'HIGH',
        data: {
          trigger: signal.push_reason || 'Trade executed by Coordinator',
          trace_id: traceId,
          decision: summary,
          analyst: scratchpad.analystVerdict,
          strategy: scratchpad.strategistPlan,
          decisions: tradeDecisions,
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      })
    } else {
      console.log(`[AutoTrade:${traceId}] Result: ${status} — ${summary.slice(0, 200)}`)
    }

    // Record all decisions to VPS
    if (scratchpad.decisions.length > 0) {
      const decisionRecords = scratchpad.decisions.map(d => ({
        agent: d.agent,
        action: 'tool_call',
        tool_name: d.tool,
        tool_args: d.args,
        tool_result: d.result,
        reasoning: summary,
      }))
      fetch(`${VPS_API}/api/decisions/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: decisionRecords }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
    }

    return Response.json({
      status,
      decision: summary,
      analyst: scratchpad.analystVerdict,
      strategy: scratchpad.strategistPlan,
      executor: scratchpad.executorResult,
      tool_calls: scratchpad.decisions.length,
      hook_blocks: scratchpad.decisions.filter(d => (d.result as Record<string, unknown>)?.hook).length,
    })
  } catch (err) {
    console.error(`[AutoTrade:${traceId}] Coordinator error:`, err)
    return Response.json({ error: String(err), trace_id: traceId }, { status: 500 })
  }
}
