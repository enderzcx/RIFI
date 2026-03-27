// SSE endpoint — AI主动推送到前端
import { pushService } from '@/lib/sse/push-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const clientId = crypto.randomUUID()

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Send initial heartbeat
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'CONNECTED', data: { clientId } })}\n\n`))

      // Register client (use 'default' wallet for now)
      const client = { id: clientId, controller }
      pushService.addClient('default', client)

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
          pushService.removeClient('default', client)
        }
      }, 30_000)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
