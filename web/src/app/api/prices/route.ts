const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET() {
  try {
    const res = await fetch(`${VPS_API}/api/prices`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
    if (res.ok) return Response.json(await res.json())
  } catch {}
  return Response.json({ prices: {}, ws_connected: false, pairs: [] })
}
