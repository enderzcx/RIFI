// Generic agent runner — gives an agent its tools and lets it loop until done

import { llm, MODEL } from '@/lib/llm/client'
import { executeTool } from '@/lib/llm/executor'
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AgentRole, AgentResult } from './types'

interface RunAgentOptions {
  role: AgentRole
  systemPrompt: string
  tools: ChatCompletionTool[]
  userMessage: string
  maxRounds?: number
  userAddress?: string
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const { role, systemPrompt, tools, userMessage, maxRounds = 6, userAddress } = opts
  const start = Date.now()

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  const toolCalls: AgentResult['toolCalls'] = []

  for (let round = 0; round < maxRounds; round++) {
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    })

    const message = response.choices[0].message
    messages.push(message)

    // No tool calls → agent is done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        role,
        content: message.content || '',
        toolCalls,
        durationMs: Date.now() - start,
        rounds: round + 1,
      }
    }

    // Execute tool calls
    for (const tc of message.tool_calls) {
      const fn = tc as { id: string; function: { name: string; arguments: string } }
      const args = JSON.parse(fn.function.arguments || '{}')
      const result = await executeTool(fn.function.name, args, userAddress)

      let parsed: unknown
      try { parsed = JSON.parse(result) } catch { parsed = result }

      toolCalls.push({ name: fn.function.name, args, result: parsed })

      messages.push({
        role: 'tool' as const,
        tool_call_id: fn.id,
        content: result,
      })
    }
  }

  // Hit max rounds — return whatever we have
  const lastContent = messages.filter(m => m.role === 'assistant').pop()
  return {
    role,
    content: (lastContent && 'content' in lastContent ? lastContent.content as string : '') || `[${role}] max rounds reached`,
    toolCalls,
    durationMs: Date.now() - start,
    rounds: maxRounds,
  }
}
