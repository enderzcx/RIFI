const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || ''
  const limit = url.searchParams.get('limit') || '50'
  try {
    const params = new URLSearchParams({ limit })
    if (status) params.set('status', status)
    const res = await fetch(`${VPS_API}/api/trades?${params}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    if (res.ok) return Response.json(await res.json())
  } catch {}
  return Response.json({ data: [], total: 0 })
}
