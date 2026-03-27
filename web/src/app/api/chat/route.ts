import { NextRequest } from 'next/server'
import { llm, MODEL } from '@/lib/llm/client'
import { tools } from '@/lib/llm/tools'
import { SYSTEM_PROMPT } from '@/lib/llm/system-prompt'
import { executeTool } from '@/lib/llm/executor'
import { getAllMemory } from '@/lib/memory'
import { getAccount } from '@/lib/chain/config'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

export async function POST(req: NextRequest) {
  const { messages } = await req.json() as { messages: ChatCompletionMessageParam[] }

  // Inject AI memory into system prompt
  const wallet = getAccount().address
  const memory = getAllMemory(wallet)
  const systemContent = memory
    ? `${SYSTEM_PROMPT}\n\n## Your Memory About This User\n${memory}`
    : SYSTEM_PROMPT

  const fullMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...messages,
  ]

  // Function calling loop: max 5 rounds
  for (let round = 0; round < 5; round++) {
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages: fullMessages,
      tools,
      tool_choice: 'auto',
    })

    const choice = response.choices[0]
    const message = choice.message

    fullMessages.push(message)

    // If no tool calls, we're done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return Response.json({
        role: 'assistant',
        content: message.content || '',
        tool_results: extractToolResults(fullMessages),
      })
    }

    // Execute each tool call
    for (const toolCall of message.tool_calls) {
      const tc = toolCall as { id: string; type: string; function: { name: string; arguments: string } }
      const args = JSON.parse(tc.function.arguments || '{}')
      const result = await executeTool(tc.function.name, args)

      fullMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
  }

  // If we hit max rounds, return last message
  const lastAssistant = fullMessages.filter(m => m.role === 'assistant').pop()
  return Response.json({
    role: 'assistant',
    content: (lastAssistant as { content?: string })?.content || 'Analysis complete.',
    tool_results: extractToolResults(fullMessages),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractToolResults(messages: any[]): Array<{
  tool: string
  args: Record<string, unknown>
  result: unknown
}> {
  const results: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = []

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const fn = tc.function || tc
        const toolResult = messages.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (m: any) => m.role === 'tool' && m.tool_call_id === tc.id
        )
        results.push({
          tool: fn.name,
          args: JSON.parse(fn.arguments || '{}'),
          result: toolResult ? safeJsonParse(toolResult.content) : null,
        })
      }
    }
  }
  return results
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
