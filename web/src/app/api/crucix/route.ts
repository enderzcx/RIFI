const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET() {
  try {
    const r = await fetch(`${VPS_API}/api/crucix`, { signal: AbortSignal.timeout(8000) })
    if (r.ok) return Response.json(await r.json())
    return Response.json({ error: 'Crucix unavailable' })
  } catch {
    return Response.json({ error: 'Crucix unavailable' })
  }
}
