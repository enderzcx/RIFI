'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { ConnectKitButton } from 'connectkit'

interface Portfolio {
  address: string
  weth: { formatted: string }
  usdc: { formatted: string }
  eth: { formatted: string }
  price: number
  totalValueUSD: string
}

type MarketMode = 'crypto' | 'stock'

interface Signals {
  macro_risk_score: number
  crypto_sentiment: number
  stock_sentiment?: number
  technical_bias: string
  recommended_action: string
  confidence: number
  briefing?: string
  alerts?: Array<{ level: string; signal: string; source: string; relevance: number }>
  llm_meta?: { model: string; duration_s: number; tokens: { total: number } }
  mode?: string
  error?: string
}

interface TradeStats {
  total_trades: number
  open_trades: number
  wins: number
  losses: number
  win_rate: string
  total_pnl: number
  avg_win: number
  avg_loss: number
  profit_factor: number
  max_drawdown: number
  open_positions: Array<{ trade_id: string; pair: string; side: string; amount: number; entry_price: number }>
  recent_closed: Array<{ trade_id: string; pair: string; side: string; pnl: number; pnl_pct: number; entry_price: number; exit_price: number; opened_at: string; closed_at: string }>
}

export default function DashboardPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [signals, setSignals] = useState<Signals | null>(null)
  const [decisions, setDecisions] = useState<Array<{ time: string; content: string }>>([])
  const [marketMode, setMarketMode] = useState<MarketMode>('crypto')
  const [tradeStats, setTradeStats] = useState<TradeStats | null>(null)

  useEffect(() => {
    fetchPortfolio()
    fetchTradeStats()
    const i1 = setInterval(fetchPortfolio, 30000)
    const i3 = setInterval(fetchTradeStats, 60000)
    return () => { clearInterval(i1); clearInterval(i3) }
  }, [])
  useEffect(() => {
    fetchSignals()
    const i2 = setInterval(fetchSignals, 60000)
    return () => clearInterval(i2)
  }, [marketMode])

  async function fetchPortfolio() {
    try {
      const res = await fetch('/api/portfolio')
      if (res.ok) setPortfolio(await res.json())
    } catch {}
  }

  async function fetchSignals() {
    try {
      const res = await fetch(`/api/signals?mode=${marketMode}`)
      if (res.ok) setSignals(await res.json())
    } catch {}
  }

  async function fetchTradeStats() {
    try {
      const res = await fetch('/api/trades/stats')
      if (res.ok) setTradeStats(await res.json())
    } catch {}
  }

  // Listen for auto-trade SSE events
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'SIGNAL_ALERT' && data.data?.decision) {
          setDecisions(prev => [{ time: new Date().toLocaleTimeString(), content: data.data.decision }, ...prev].slice(0, 20))
        }
      } catch {}
    }
    return () => es.close()
  }, [])

  const riskColor = (v: number) => v > 70 ? 'text-red-400' : v > 40 ? 'text-yellow-400' : 'text-green-400'
  const sentColor = (v: number) => v > 60 ? 'text-green-400' : v > 40 ? 'text-zinc-400' : 'text-red-400'

  return (
    <div className="h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-medium text-zinc-400">Dashboard</h2>
          <ConnectKitButton />
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-4 mb-4">
            {/* Portfolio */}
            <div className="glass-card p-5">
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-4">Portfolio</h3>
              {portfolio ? (
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">WETH</span><span className="text-sm font-mono">{Number(portfolio.weth.formatted).toFixed(6)}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">USDC</span><span className="text-sm font-mono">{Number(portfolio.usdc.formatted).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Gas</span><span className="text-sm font-mono">{Number(portfolio.eth.formatted).toFixed(4)}</span></div>
                  <div className="pt-2 border-t border-white/[0.06] flex justify-between">
                    <span className="text-xs text-zinc-500">ETH Price</span>
                    <span className="text-sm font-mono text-green-400">${portfolio.price?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-zinc-500">Total</span>
                    <span className="text-sm font-semibold">${portfolio.totalValueUSD}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-600 animate-pulse">Loading...</p>
              )}
            </div>

            {/* Signals */}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Market Intelligence</h3>
                <div className="flex gap-1">
                  {(['crypto', 'stock'] as MarketMode[]).map(m => (
                    <button key={m} onClick={() => setMarketMode(m)}
                      className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
                        marketMode === m ? 'bg-violet-500/20 text-violet-400' : 'bg-white/[0.06] text-zinc-600 hover:text-zinc-400'
                      }`}>
                      {m === 'crypto' ? 'Crypto' : 'Stock'}
                    </button>
                  ))}
                </div>
              </div>
              {signals && !signals.error ? (
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Macro Risk</span><span className={`text-sm font-mono ${riskColor(signals.macro_risk_score)}`}>{signals.macro_risk_score}/100</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">{marketMode === 'stock' ? 'Stock Sentiment' : 'Sentiment'}</span><span className={`text-sm font-mono ${sentColor(marketMode === 'stock' ? (signals.stock_sentiment ?? 0) : signals.crypto_sentiment)}`}>{marketMode === 'stock' ? (signals.stock_sentiment ?? 0) : signals.crypto_sentiment}/100</span></div>
                  <div className="flex justify-between">
                    <span className="text-xs text-zinc-500">Bias</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      signals.technical_bias === 'long' ? 'bg-green-500/15 text-green-400' :
                      signals.technical_bias === 'short' ? 'bg-red-500/15 text-red-400' :
                      'bg-zinc-500/15 text-zinc-400'
                    }`}>{signals.technical_bias}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Action</span><span className="text-xs text-zinc-300">{signals.recommended_action}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Confidence</span><span className="text-xs text-zinc-300">{signals.confidence}/100</span></div>
                  {signals.llm_meta && (
                    <div className="pt-2 border-t border-white/[0.06] text-[10px] text-zinc-600">
                      {signals.llm_meta.model} | {signals.llm_meta.duration_s}s | {signals.llm_meta.tokens.total} tokens
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">{signals?.error || 'Connecting...'}</p>
              )}
            </div>

            {/* Briefing */}
            <div className="glass-card p-5">
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-4">AI Briefing</h3>
              {signals?.briefing ? (
                <p className="text-sm text-zinc-300 leading-relaxed">{signals.briefing}</p>
              ) : (
                <p className="text-xs text-zinc-600">Waiting for analysis...</p>
              )}
            </div>
          </div>

          {/* Alerts */}
          {signals?.alerts && signals.alerts.length > 0 && (
            <div className="glass-card p-5 mb-4">
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Alerts</h3>
              <div className="space-y-2">
                {signals.alerts.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 text-sm px-3 py-2 rounded-lg ${
                    a.level === 'FLASH' ? 'bg-red-500/10 border border-red-500/20' :
                    a.level === 'PRIORITY' ? 'bg-yellow-500/10 border border-yellow-500/20' :
                    'bg-zinc-800/50 border border-white/[0.04]'
                  }`}>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      a.level === 'FLASH' ? 'bg-red-500/20 text-red-300' :
                      a.level === 'PRIORITY' ? 'bg-yellow-500/20 text-yellow-300' :
                      'bg-zinc-700 text-zinc-400'
                    }`}>{a.level}</span>
                    <span className="text-zinc-300 flex-1">{a.signal}</span>
                    <span className="text-[10px] text-zinc-600">{a.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PnL & Trade Stats */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="glass-card p-5">
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Trading Performance</h3>
              {tradeStats && tradeStats.total_trades > 0 ? (
                <div className="space-y-2">
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Total PnL</span><span className={`text-sm font-mono font-semibold ${tradeStats.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{tradeStats.total_pnl >= 0 ? '+' : ''}{tradeStats.total_pnl}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Win Rate</span><span className="text-sm font-mono">{tradeStats.win_rate}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Trades</span><span className="text-sm font-mono">{tradeStats.total_trades} ({tradeStats.wins}W / {tradeStats.losses}L)</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Profit Factor</span><span className="text-sm font-mono">{tradeStats.profit_factor}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Max Drawdown</span><span className="text-sm font-mono text-red-400">{tradeStats.max_drawdown}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Avg Win / Loss</span><span className="text-sm font-mono">{tradeStats.avg_win} / {tradeStats.avg_loss}</span></div>
                  {tradeStats.open_trades > 0 && (
                    <div className="pt-2 border-t border-white/[0.06] text-[10px] text-yellow-400">{tradeStats.open_trades} open position(s)</div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">No trades recorded yet.</p>
              )}
            </div>

            <div className="glass-card p-5">
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Recent Trades</h3>
              {tradeStats?.recent_closed && tradeStats.recent_closed.length > 0 ? (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {tradeStats.recent_closed.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg bg-white/[0.03]">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{t.side.toUpperCase()}</span>
                        <span className="text-zinc-500">{t.pair}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-mono ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.pnl >= 0 ? '+' : ''}{t.pnl}</span>
                        <span className="text-zinc-600 ml-1.5">${t.entry_price?.toFixed(0)}-${t.exit_price?.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">Closed trades will appear here.</p>
              )}
            </div>
          </div>

          {/* Decision Log */}
          <div className="glass-card p-5">
            <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">AI Decision Log</h3>
            {decisions.length === 0 ? (
              <p className="text-xs text-zinc-600">Sentinel auto-trade decisions will appear here.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {decisions.map((d, i) => (
                  <div key={i} className="border border-white/[0.06] rounded-lg p-3">
                    <span className="text-[10px] text-zinc-600">{d.time}</span>
                    <p className="text-sm text-zinc-300 mt-1 whitespace-pre-wrap">{d.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
