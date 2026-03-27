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

interface Signals {
  macro_risk_score: number
  crypto_sentiment: number
  technical_bias: string
  recommended_action: string
  confidence: number
  briefing?: string
  alerts?: Array<{ level: string; signal: string; source: string; relevance: number }>
  llm_meta?: { model: string; duration_s: number; tokens: { total: number } }
  error?: string
}

export default function DashboardPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [signals, setSignals] = useState<Signals | null>(null)
  const [decisions, setDecisions] = useState<Array<{ time: string; content: string }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchPortfolio()
    fetchSignals()
    const i1 = setInterval(fetchPortfolio, 30000)
    const i2 = setInterval(fetchSignals, 60000)
    return () => { clearInterval(i1); clearInterval(i2) }
  }, [])

  async function fetchPortfolio() {
    try {
      const res = await fetch('/api/portfolio')
      if (res.ok) setPortfolio(await res.json())
    } catch {}
  }

  async function fetchSignals() {
    try {
      const res = await fetch('/api/signals')
      if (res.ok) setSignals(await res.json())
    } catch {}
  }

  async function triggerAutoOnce() {
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Run one auto-analysis cycle: check signals, price, portfolio, and decide whether to trade. Be concise.' }]
        }),
      })
      const data = await res.json()
      setDecisions(prev => [{ time: new Date().toLocaleTimeString(), content: data.content }, ...prev].slice(0, 20))
    } catch (err) {
      setDecisions(prev => [{ time: new Date().toLocaleTimeString(), content: `Error: ${err}` }, ...prev])
    }
    setLoading(false)
  }

  const riskColor = (v: number) => v > 70 ? 'text-red-400' : v > 40 ? 'text-yellow-400' : 'text-green-400'
  const sentColor = (v: number) => v > 60 ? 'text-green-400' : v > 40 ? 'text-zinc-400' : 'text-red-400'

  return (
    <div className="h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-medium text-zinc-400">Dashboard</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={triggerAutoOnce}
              disabled={loading}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? 'Running...' : 'Run Analysis'}
            </button>
            <ConnectKitButton />
          </div>
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
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-4">Market Intelligence</h3>
              {signals && !signals.error ? (
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Macro Risk</span><span className={`text-sm font-mono ${riskColor(signals.macro_risk_score)}`}>{signals.macro_risk_score}/100</span></div>
                  <div className="flex justify-between"><span className="text-xs text-zinc-500">Sentiment</span><span className={`text-sm font-mono ${sentColor(signals.crypto_sentiment)}`}>{signals.crypto_sentiment}/100</span></div>
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

          {/* Decision Log */}
          <div className="glass-card p-5">
            <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">AI Decision Log</h3>
            {decisions.length === 0 ? (
              <p className="text-xs text-zinc-600">Click &quot;Run Analysis&quot; to trigger an AI decision cycle.</p>
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
