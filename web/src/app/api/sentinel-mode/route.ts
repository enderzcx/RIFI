const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET() {
  try {
    const r = await fetch(`${VPS_API}/api/sentinel-mode`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) return Response.json(await r.json())
    return Response.json({ mode: 'conservative' })
  } catch {
    return Response.json({ mode: 'conservative' })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const r = await fetch(`${VPS_API}/api/sentinel-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    return Response.json(await r.json())
  } catch {
    return Response.json({ error: 'VPS not reachable' }, { status: 502 })
  }
}
