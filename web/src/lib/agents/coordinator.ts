// Coordinator: orchestrates Analyst → Strategist → Executor pipeline

import { runAgent } from './runner'
import { ANALYST_TOOLS, STRATEGIST_TOOLS, EXECUTOR_TOOLS } from './tool-sets'
import { ANALYST_PROMPT, STRATEGIST_PROMPT, EXECUTOR_PROMPT } from './prompts'
import type { AgentRole, AgentResult, Scratchpad } from './types'

interface CoordinatorResult {
  status: 'traded' | 'hold' | 'error'
  scratchpad: Scratchpad
  summary: string
}

export async function runCoordinator(
  signal: Record<string, unknown>,
  traceId: string,
  userAddress?: string,
): Promise<CoordinatorResult> {
  const scratchpad: Scratchpad = {
    signal,
    traceId,
    decisions: [],
  }

  // ---- Stage 1: Analyst ----
  console.log(`[Coordinator:${traceId}] Stage 1: Analyst`)
  const analystResult = await runAgent({
    role: 'analyst',
    systemPrompt: ANALYST_PROMPT,
    tools: ANALYST_TOOLS,
    userMessage: buildAnalystInput(signal),
    maxRounds: 4,
    userAddress,
  })

  // Parse analyst verdict from response
  const analystVerdict = parseJsonBlock(analystResult.content)
  if (!analystVerdict) {
    console.error(`[Coordinator:${traceId}] Analyst returned no parseable verdict`)
    return { status: 'error', scratchpad, summary: 'Analyst failed to produce verdict' }
  }

  scratchpad.analystVerdict = {
    action: (analystVerdict.action as string) || 'hold',
    confidence: (analystVerdict.confidence as number) || 0,
    briefing: (analystVerdict.briefing as string) || '',
    riskScore: (analystVerdict.risk_score as number) || (analystVerdict.macro_risk_score as number) || 0,
  }
  scratchpad.decisions.push(...mapToolCalls('analyst', analystResult.toolCalls))

  console.log(`[Coordinator:${traceId}] Analyst: action=${scratchpad.analystVerdict.action} conf=${scratchpad.analystVerdict.confidence}`)

  // Gate: if analyst says hold or confidence too low, stop here
  if (scratchpad.analystVerdict.action === 'hold' || scratchpad.analystVerdict.confidence < 50) {
    return {
      status: 'hold',
      scratchpad,
      summary: `Analyst recommends ${scratchpad.analystVerdict.action} (confidence: ${scratchpad.analystVerdict.confidence}). ${scratchpad.analystVerdict.briefing}`,
    }
  }

  // ---- Stage 2: Strategist ----
  console.log(`[Coordinator:${traceId}] Stage 2: Strategist`)
  const strategistResult = await runAgent({
    role: 'strategist',
    systemPrompt: STRATEGIST_PROMPT,
    tools: STRATEGIST_TOOLS,
    userMessage: buildStrategistInput(scratchpad),
    maxRounds: 4,
    userAddress,
  })

  const strategistPlan = parseJsonBlock(strategistResult.content)
  if (!strategistPlan) {
    console.error(`[Coordinator:${traceId}] Strategist returned no parseable plan`)
    return { status: 'error', scratchpad, summary: 'Strategist failed to produce plan' }
  }

  scratchpad.strategistPlan = {
    direction: (strategistPlan.direction as 'buy' | 'sell' | 'hold') || 'hold',
    amount: (strategistPlan.amount as string) || '0',
    reason: (strategistPlan.reason as string) || (strategistPlan.skip_reason as string) || '',
    stopLoss: strategistPlan.stop_loss as number | undefined,
    takeProfit: strategistPlan.take_profit as number | undefined,
  }
  scratchpad.decisions.push(...mapToolCalls('strategist', strategistResult.toolCalls))

  console.log(`[Coordinator:${traceId}] Strategist: ${scratchpad.strategistPlan.direction} ${scratchpad.strategistPlan.amount}`)

  // Gate: if strategist says hold, stop
  if (scratchpad.strategistPlan.direction === 'hold') {
    return {
      status: 'hold',
      scratchpad,
      summary: `Strategist: hold. ${scratchpad.strategistPlan.reason}`,
    }
  }

  // ---- Stage 3: Executor ----
  console.log(`[Coordinator:${traceId}] Stage 3: Executor`)
  const executorResult = await runAgent({
    role: 'executor',
    systemPrompt: EXECUTOR_PROMPT,
    tools: EXECUTOR_TOOLS,
    userMessage: buildExecutorInput(scratchpad),
    maxRounds: 6,
    userAddress,
  })

  // Check if executor actually traded
  const tradedTools = ['session_swap', 'market_swap', 'set_stop_loss', 'set_take_profit']
  const executedTrades = executorResult.toolCalls.filter(tc => tradedTools.includes(tc.name))
  const traded = executedTrades.length > 0

  scratchpad.executorResult = {
    traded,
    txHash: extractTxHash(executedTrades),
    summary: executorResult.content,
  }
  scratchpad.decisions.push(...mapToolCalls('executor', executorResult.toolCalls))

  console.log(`[Coordinator:${traceId}] Executor: traded=${traded} tools=${executorResult.toolCalls.length}`)

  return {
    status: traded ? 'traded' : 'hold',
    scratchpad,
    summary: executorResult.content,
  }
}

// --- Helper: map agent toolCalls to scratchpad format ---

function mapToolCalls(agent: AgentRole, calls: AgentResult['toolCalls']) {
  return calls.map(tc => ({ agent, tool: tc.name, args: tc.args, result: tc.result }))
}

// --- Helper: build input messages for each agent ---

function buildAnalystInput(signal: Record<string, unknown>): string {
  const riskInfo = signal.risk_verdict
    ? `\nVPS Risk Agent: PASS — ${(signal.risk_verdict as Record<string, unknown>).reason || ''}`
    : ''

  return `[SIGNAL FROM VPS]
${JSON.stringify(signal, null, 2)}
${riskInfo}

Analyze the current market situation using your tools. Produce your verdict as a JSON block.`
}

function buildStrategistInput(pad: Scratchpad): string {
  return `[ANALYST VERDICT]
Action: ${pad.analystVerdict!.action}
Confidence: ${pad.analystVerdict!.confidence}
Risk Score: ${pad.analystVerdict!.riskScore}
Briefing: ${pad.analystVerdict!.briefing}

Based on this analysis, check portfolio and session, then decide exact trade parameters. Respond with a JSON block.`
}

function buildExecutorInput(pad: Scratchpad): string {
  const plan = pad.strategistPlan!
  return `[APPROVED TRADE PLAN]
Direction: ${plan.direction}
Amount: ${plan.amount}${plan.direction === 'buy' ? ' USDC' : ' WETH'}
Reason: ${plan.reason}
Stop Loss: ${plan.stopLoss || 'none'}
Take Profit: ${plan.takeProfit || 'none'}

Execute this plan. Verify session and price before executing.`
}

// --- Helper: extract JSON block from mixed text ---

function parseJsonBlock(text: string): Record<string, unknown> | null {
  // Try to find ```json ... ``` block first
  const fenced = text.match(/```json\s*\n?([\s\S]*?)```/)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch {}
  }

  // Try balanced brace extraction: find first { and match to its closing }
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    if (depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
    }
  }

  return null
}

function extractTxHash(trades: Array<{ result: unknown }>): string | undefined {
  for (const t of trades) {
    const r = t.result as Record<string, unknown> | null
    if (r?.txHash) return r.txHash as string
    if (r?.tx_hash) return r.tx_hash as string
  }
  return undefined
}
