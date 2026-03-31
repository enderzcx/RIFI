const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode') === 'stock' ? 'stock' : 'crypto'
  try {
    const res = await fetch(`${VPS_API}/api/signals?mode=${mode}`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`VPS ${res.status}`)
    return Response.json(await res.json())
  } catch {
    return Response.json({
      macro_risk_score: 0,
      crypto_sentiment: 0,
      stock_sentiment: 0,
      technical_bias: 'unknown',
      recommended_action: 'hold',
      alerts: [],
      mode,
      error: 'VPS not reachable',
    })
  }
}
