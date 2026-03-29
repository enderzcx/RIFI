const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET(req: Request) {
  const limit = new URL(req.url).searchParams.get('limit') || '10'
  try {
    const r = await fetch(`${VPS_API}/api/news?limit=${limit}`, { signal: AbortSignal.timeout(8000) })
    if (r.ok) return Response.json(await r.json())
    return Response.json([])
  } catch {
    return Response.json([])
  }
}
