const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function GET() {
  try {
    const res = await fetch(`${VPS_API}/api/trades/stats`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    if (res.ok) return Response.json(await res.json())
  } catch {}
  return Response.json({
    total_trades: 0, open_trades: 0, wins: 0, losses: 0,
    win_rate: 'N/A', total_pnl: 0, avg_win: 0, avg_loss: 0,
    profit_factor: 0, max_drawdown: 0, open_positions: [], recent_closed: [],
  })
}
