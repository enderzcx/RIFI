import { NextRequest } from 'next/server'
import { pushService } from '@/lib/sse/push-service'

const AUTO_TRADE_SECRET = process.env.AUTO_TRADE_SECRET || 'rifi-auto-2026'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${AUTO_TRADE_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await req.json().catch(() => null)
  if (!payload) {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  pushService.broadcastAll(payload)
  return Response.json({ status: 'pushed' })
}
