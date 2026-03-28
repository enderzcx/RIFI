import { NextRequest } from 'next/server'
import { llm, MODEL } from '@/lib/llm/client'
import { tools } from '@/lib/llm/tools'
import { SYSTEM_PROMPT } from '@/lib/llm/system-prompt'
import { executeTool } from '@/lib/llm/executor'
import { getAllMemory } from '@/lib/memory'
import { getAccount } from '@/lib/chain/config'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  const { messages, userAddress } = await req.json() as { messages: ChatCompletionMessageParam[]; userAddress?: string }

  const wallet = userAddress || getAccount().address
  const memory = getAllMemory(wallet)
  const systemContent = memory
    ? `${SYSTEM_PROMPT}\n\n## Your Memory About This User\n${memory}`
    : SYSTEM_PROMPT

  const fullMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...messages,
  ]

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const push = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(sse(data))) } catch {}
      }

      try {
        const allToolResults: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = []

        for (let round = 0; round < 5; round++) {
          // Use streaming for content, but we need to collect tool_calls too
          const stream = await llm.chat.completions.create({
            model: MODEL,
            messages: fullMessages,
            tools,
            tool_choice: 'auto',
            stream: true,
          })

          let contentBuffer = ''
          let toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = []

          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue

            // Stream content tokens
            if (delta.content) {
              contentBuffer += delta.content
              push({ type: 'content_delta', text: delta.content })
            }

            // Accumulate tool calls from deltas
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: '', function: { name: '', arguments: '' } }
                }
                if (tc.id) toolCalls[idx].id = tc.id
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
              }
            }
          }

          // Add assistant message to context
          const assistantMsg: ChatCompletionMessageParam = {
            role: 'assistant' as const,
            content: contentBuffer || null,
            ...(toolCalls.length > 0 ? {
              tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: tc.function,
              }))
            } : {}),
          }
          fullMessages.push(assistantMsg)

          // No tool calls = done
          if (toolCalls.length === 0) break

          // Execute tools with streaming feedback
          for (const tc of toolCalls) {
            const args = safeJsonParse(tc.function.arguments) as Record<string, unknown>
            push({ type: 'tool_start', tool: tc.function.name, args })

            const result = await executeTool(tc.function.name, args, wallet)
            const parsed = safeJsonParse(result)

            push({ type: 'tool_end', tool: tc.function.name, args, result: parsed })

            allToolResults.push({ tool: tc.function.name, args, result: parsed })

            fullMessages.push({
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: result,
            })
          }
        }

        push({ type: 'done', tool_results: allToolResults })
      } catch (err) {
        push({ type: 'error', message: String(err) })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
