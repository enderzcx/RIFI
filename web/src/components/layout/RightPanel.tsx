'use client'

import { useEffect, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useWriteContract, useSwitchChain, useReadContract } from 'wagmi'
import { parseEther } from 'viem'
import { base } from 'wagmi/chains'

interface PortfolioData {
  weth: { formatted: string }
  usdc: { formatted: string }
  eth: { formatted: string }
  price: number
  totalValueUSD: string
}

type MarketMode = 'crypto' | 'stock'

interface PriceEntry {
  price: number
  change5m: number
  high5m: number
  low5m: number
  updated: string | null
}

interface PricesData {
  prices: Record<string, PriceEntry>
  ws_connected: boolean
  pairs: string[]
}

interface SignalData {
  macro_risk_score: number
  crypto_sentiment: number
  stock_sentiment?: number
  technical_bias: string
  recommended_action: string
  briefing?: string
  alerts?: Array<{ level: string; signal: string; source: string }>
  mode?: string
}

interface OrderData {
  orderId: number
  isStopLoss: boolean
  threshold: number
  amount: string
  active: boolean
  status?: string
}

const SESSION_MANAGER = '0x342168e8D2BF8315BbF72F409A94f1EC7570f611' as `0x${string}` // V2
const EXECUTOR = '0x0309dc91bB89750C317Ec69566bAF1613b57e6bB' as `0x${string}`
const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`
const SESSION_ABI = [
  { type: 'function', name: 'createSession', inputs: [{ name: '_executor', type: 'address' }, { name: '_totalBudget', type: 'uint256' }, { name: '_durationSeconds', type: 'uint256' }, { name: '_tokenPairs', type: 'address[]' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeSession', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getSession', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: 'executor', type: 'address' }, { name: 'maxPerTrade', type: 'uint256' }, { name: 'totalBudget', type: 'uint256' }, { name: 'spent', type: 'uint256' }, { name: 'remaining', type: 'uint256' }, { name: 'dailyRemaining', type: 'uint256' }, { name: 'expiry', type: 'uint256' }, { name: 'active', type: 'bool' }, { name: 'expired', type: 'bool' }], stateMutability: 'view' },
] as const

type Tab = 'portfolio' | 'market' | 'sentinel'

export function RightPanel() {
  const { isConnected, address } = useAccount()
  const [tab, setTab] = useState<Tab>('portfolio')
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [signals, setSignals] = useState<SignalData | null>(null)
  const [orders, setOrders] = useState<OrderData[]>([])
  const [sessionPending, setSessionPending] = useState(false)
  const [sentinelMode, setSentinelMode] = useState<'aggressive' | 'conservative'>('conservative')
  const [modeSwitching, setModeSwitching] = useState(false)
  const [marketMode, setMarketMode] = useState<MarketMode>('crypto')
  const [prices, setPrices] = useState<PricesData | null>(null)

  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()

  const { data: sessionData, refetch: refetchSession } = useReadContract({
    address: SESSION_MANAGER, abi: SESSION_ABI, functionName: 'getSession',
    args: address ? [address] : undefined, chainId: base.id,
    query: { enabled: !!address, refetchInterval: 30000 },
  })

  const sessionActive = !!(sessionData && sessionData[7] && !sessionData[8])
  const sessionRemaining = sessionData ? Number(sessionData[4]) / 1e18 : 0
  const sessionExpiry = sessionData ? Number(sessionData[6]) : 0

  async function handleEnableAutoTrading() {
    if (!isConnected) return
    setSessionPending(true)
    try {
      try { await switchChainAsync({ chainId: base.id }) } catch {}

      // Step 1: Create session
      await writeContractAsync({ address: SESSION_MANAGER, abi: SESSION_ABI, functionName: 'createSession',
        args: [EXECUTOR, parseEther('0.02'), BigInt(86400), [WETH, USDC]], chainId: base.id })

      // Step 2: Approve WETH to Callback (for stop-loss/take-profit)
      const CALLBACK = '0x9702220849b78318d7596B0F6503081DeE0a64f3' as `0x${string}`
      const ERC20 = [{ type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }] as const
      await writeContractAsync({ address: WETH, abi: ERC20, functionName: 'approve',
        args: [CALLBACK, parseEther('1')], chainId: base.id }) // approve 1 WETH for SL/TP

      // Step 3: Approve WETH + USDC to Uniswap Router (for swaps)
      const ROUTER = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as `0x${string}`
      await writeContractAsync({ address: WETH, abi: ERC20, functionName: 'approve',
        args: [ROUTER, parseEther('1')], chainId: base.id })
      await writeContractAsync({ address: USDC, abi: ERC20, functionName: 'approve',
        args: [ROUTER, BigInt(1000 * 1e6)], chainId: base.id }) // 1000 USDC

      await refetchSession()
    } catch (err) { console.error('Session creation failed:', err) }
    setSessionPending(false)
  }

  async function handleRevokeSession() {
    try {
      try { await switchChainAsync({ chainId: base.id }) } catch {}
      await writeContractAsync({ address: SESSION_MANAGER, abi: SESSION_ABI, functionName: 'revokeSession', chainId: base.id })
      await refetchSession()
    } catch (err) { console.error('Session revoke failed:', err) }
  }

  useEffect(() => { fetchSentinelMode(); fetchPrices() }, [])
  useEffect(() => {
    if (!isConnected) return
    fetchPortfolio(); fetchOrders()
    const i1 = setInterval(fetchPortfolio, 30000)
    const i3 = setInterval(fetchOrders, 30000)
    const i4 = setInterval(fetchPrices, 5000)
    return () => { clearInterval(i1); clearInterval(i3); clearInterval(i4) }
  }, [isConnected])
  useEffect(() => {
    if (!isConnected) return
    fetchSignals()
    const i2 = setInterval(fetchSignals, 60000)
    return () => clearInterval(i2)
  }, [isConnected, marketMode])

  async function fetchSentinelMode() {
    try { const r = await fetch('/api/sentinel-mode'); if (r.ok) { const d = await r.json(); if (d.mode) setSentinelMode(d.mode) } } catch {}
  }
  async function toggleSentinelMode() {
    const newMode = sentinelMode === 'conservative' ? 'aggressive' : 'conservative'
    setModeSwitching(true)
    try { const r = await fetch('/api/sentinel-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: newMode }) }); if (r.ok) { const d = await r.json(); if (d.mode) setSentinelMode(d.mode) } } catch {}
    setModeSwitching(false)
  }
  async function fetchPortfolio() { try { const r = await fetch(`/api/portfolio${address ? `?wallet=${address}` : ''}`); if (r.ok) setPortfolio(await r.json()) } catch {} }
  async function fetchSignals() { try { const r = await fetch(`/api/signals?mode=${marketMode}`); if (r.ok) setSignals(await r.json()) } catch {} }
  async function fetchPrices() { try { const r = await fetch('/api/prices'); if (r.ok) setPrices(await r.json()) } catch {} }
  const [allOrders, setAllOrders] = useState<OrderData[]>([])
  async function fetchOrders() { try { const r = await fetch(`/api/orders${address ? `?wallet=${address}` : ''}`); if (r.ok) { const d = await r.json(); setOrders(d.active || []); setAllOrders([...(d.active || []), ...(d.recent || [])]) } } catch {} }

  const riskColor = (v: number) => v > 70 ? 'text-red-400' : v > 40 ? 'text-yellow-400' : 'text-green-400'
  const sentColor = (v: number) => v > 60 ? 'text-green-400' : v > 40 ? 'text-zinc-400' : 'text-red-400'

  return (
    <div className="w-[380px] h-full bg-[#0a0d12] flex flex-col overflow-hidden relative z-10 shrink-0">
      {/* Wallet header */}
      <div className="px-4 pt-3 pb-2">
        <ConnectKitButton />
        {isConnected && portfolio && (
          <div className="mt-2">
            <span className="text-xl font-semibold">${portfolio.totalValueUSD}</span>
            <span className="text-[10px] text-zinc-500 ml-2">on Base</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex px-2 gap-0.5">
        {(['portfolio', 'market', 'sentinel'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[10px] uppercase tracking-wider font-medium transition-colors rounded-t-lg ${
              tab === t ? 'text-violet-400 bg-white/[0.04] border-b-2 border-violet-400' : 'text-zinc-600 hover:text-zinc-400'
            }`}>
            {t === 'portfolio' ? 'Portfolio' : t === 'market' ? 'Market' : 'Sentinel'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">

        {/* ===== PORTFOLIO TAB ===== */}
        {tab === 'portfolio' && <>
          <div className="glass-card p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">Assets</h3>
            {isConnected && portfolio ? (
              <div className="space-y-0.5">
                {(() => { const b = Number(portfolio.eth.formatted); const u = b * (portfolio.price || 0); return (
                  <div className="flex items-center gap-2.5 px-1.5 py-2 rounded-lg hover:bg-white/[0.03]">
                    <div className="w-7 h-7 rounded-full bg-[#627EEA]/20 flex items-center justify-center text-[10px] font-bold text-[#627EEA]">E</div>
                    <div className="flex-1"><div className="flex justify-between"><span className="text-xs font-medium">ETH</span><span className="text-xs font-mono">${u.toFixed(2)}</span></div><span className="text-[10px] text-zinc-500">{b.toFixed(4)}</span></div>
                  </div>
                ) })()}
                {(() => { const b = Number(portfolio.usdc.formatted); return (
                  <div className="flex items-center gap-2.5 px-1.5 py-2 rounded-lg hover:bg-white/[0.03]">
                    <div className="w-7 h-7 rounded-full bg-[#2775CA]/20 flex items-center justify-center text-[10px] font-bold text-[#2775CA]">$</div>
                    <div className="flex-1"><div className="flex justify-between"><span className="text-xs font-medium">USDC</span><span className="text-xs font-mono">${b.toFixed(2)}</span></div><span className="text-[10px] text-zinc-500">{b.toFixed(3)}</span></div>
                  </div>
                ) })()}
                {(() => { const b = Number(portfolio.weth.formatted); const u = b * (portfolio.price || 0); return b > 0 ? (
                  <div className="flex items-center gap-2.5 px-1.5 py-2 rounded-lg hover:bg-white/[0.03]">
                    <div className="w-7 h-7 rounded-full bg-[#EC4899]/20 flex items-center justify-center text-[9px] font-bold text-[#EC4899]">W</div>
                    <div className="flex-1"><div className="flex justify-between"><span className="text-xs font-medium">WETH</span><span className="text-xs font-mono">${u.toFixed(2)}</span></div><span className="text-[10px] text-zinc-500">{b.toFixed(6)}</span></div>
                  </div>
                ) : null })()}
              </div>
            ) : (<p className="text-[10px] text-zinc-600">{isConnected ? 'Loading...' : 'Connect wallet'}</p>)}
          </div>

          <div className="glass-card p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
              Orders {orders.length > 0 ? `(${orders.length} active)` : ''}
            </h3>
            {allOrders.length > 0 ? (
              <div className="space-y-1.5">
                {allOrders.map(o => (
                  <div key={o.orderId} className={`flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg ${
                    o.active ? 'bg-white/[0.04] border border-white/[0.06]' : 'bg-white/[0.02]'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${o.active ? 'bg-green-400' : 'bg-zinc-600'}`}/>
                      <span className={o.active ? 'text-zinc-200' : 'text-zinc-500'}>{o.isStopLoss ? 'Stop Loss' : 'Take Profit'}</span>
                    </div>
                    <div className="text-right">
                      <span className={`font-mono ${o.active ? 'text-zinc-300' : 'text-zinc-600'}`}>@ ${o.threshold?.toLocaleString()}</span>
                      <span className="text-zinc-600 ml-1.5">{o.amount}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-zinc-600">No orders yet. Ask AI to set a stop-loss.</p>
            )}
          </div>
        </>}

        {/* ===== MARKET TAB ===== */}
        {tab === 'market' && <>
          {/* Mode Toggle */}
          <div className="flex gap-1 mb-2">
            {(['crypto', 'stock'] as MarketMode[]).map(m => (
              <button key={m} onClick={() => setMarketMode(m)}
                className={`flex-1 py-1.5 text-[10px] uppercase tracking-wider font-medium rounded-lg transition-colors ${
                  marketMode === m ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'bg-white/[0.04] text-zinc-600 hover:text-zinc-400 border border-transparent'
                }`}>
                {m === 'crypto' ? 'Crypto' : 'US Stock'}
              </button>
            ))}
          </div>

          {/* Live Prices */}
          {marketMode === 'crypto' && prices?.prices && (
            <div className="glass-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-300">Live Prices</span>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${prices.ws_connected ? 'bg-green-400' : 'bg-red-400'}`}/>
                  <span className="text-[8px] text-zinc-600">{prices.ws_connected ? 'OKX Live' : 'Offline'}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {prices.pairs.map(pair => {
                  const p = prices.prices[pair]
                  if (!p || !p.price) return null
                  const symbol = pair.replace('-USDT', '')
                  const changeColor = p.change5m > 0 ? 'text-green-400' : p.change5m < 0 ? 'text-red-400' : 'text-zinc-500'
                  return (
                    <div key={pair} className="flex items-center justify-between px-1.5 py-1 rounded-lg hover:bg-white/[0.03]">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-300">{symbol}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-zinc-200">${p.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        <span className={`text-[9px] font-mono ${changeColor}`}>{p.change5m > 0 ? '+' : ''}{p.change5m.toFixed(2)}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {marketMode === 'stock' && (
            <div className="glass-card p-3">
              <span className="text-xs font-medium text-zinc-300">S&P 500</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-[11px] text-zinc-500">Stock prices via OKX WebSocket not available. Use Crucix macro data.</span>
              </div>
            </div>
          )}

          {/* Risk & Sentiment */}
          <div className="glass-card p-3 space-y-2">
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Risk & Sentiment</h3>
            {signals ? (<>
              <div>
                <div className="flex justify-between text-[11px] mb-1"><span className="text-zinc-500">Macro Risk</span><span className={riskColor(signals.macro_risk_score)}>{signals.macro_risk_score}/100</span></div>
                <div className="w-full h-1 bg-white/[0.06] rounded-full"><div className="h-1 bg-yellow-400/60 rounded-full" style={{width: `${signals.macro_risk_score}%`}}/></div>
              </div>
              <div>
                {(() => {
                  const sentLabel = marketMode === 'stock' ? 'Stock Sentiment' : 'Sentiment'
                  const sentVal = marketMode === 'stock' ? (signals.stock_sentiment ?? 0) : signals.crypto_sentiment
                  return (<>
                    <div className="flex justify-between text-[11px] mb-1"><span className="text-zinc-500">{sentLabel}</span><span className={sentColor(sentVal)}>{sentVal}/100</span></div>
                    <div className="w-full h-1 bg-white/[0.06] rounded-full"><div className="h-1 bg-zinc-400/60 rounded-full" style={{width: `${sentVal}%`}}/></div>
                  </>)
                })()}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-500">Bias</span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${signals.technical_bias === 'long' ? 'bg-green-500/15 text-green-400' : signals.technical_bias === 'short' ? 'bg-red-500/15 text-red-400' : 'bg-zinc-500/15 text-zinc-400'}`}>{signals.technical_bias}</span>
              </div>
            </>) : (<p className="text-[10px] text-zinc-600">Connecting to VPS...</p>)}
          </div>

          {/* Briefing */}
          {signals?.briefing && (
            <div className="glass-card p-3">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">AI Briefing</h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">{signals.briefing}</p>
            </div>
          )}

          {/* Alerts */}
          {signals?.alerts && signals.alerts.length > 0 && (
            <div className="glass-card p-3">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Alerts</h3>
              <div className="space-y-1.5">
                {signals.alerts.slice(0, 4).map((a, i) => (
                  <div key={i} className={`text-[10px] px-2 py-1.5 rounded-lg ${
                    a.level === 'FLASH' ? 'bg-red-500/10 text-red-300 border border-red-500/20' :
                    a.level === 'PRIORITY' ? 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20' :
                    'bg-zinc-800/50 text-zinc-500'
                  }`}><span className="font-medium">{a.level}</span> {a.signal}</div>
                ))}
              </div>
            </div>
          )}
        </>}

        {/* ===== SENTINEL TAB ===== */}
        {tab === 'sentinel' && <>
          <div className="glass-card p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">Sentinel Mode</h3>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${sentinelMode === 'aggressive' ? 'bg-orange-400 animate-pulse' : 'bg-blue-400'}`}/>
                <span className={`text-xs font-medium ${sentinelMode === 'aggressive' ? 'text-orange-400' : 'text-blue-400'}`}>
                  {sentinelMode === 'aggressive' ? 'Aggressive' : 'Conservative'}
                </span>
              </div>
              <button onClick={toggleSentinelMode} disabled={modeSwitching}
                className={`text-[10px] px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${sentinelMode === 'aggressive' ? 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10' : 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'}`}>
                {modeSwitching ? '...' : sentinelMode === 'aggressive' ? 'Conservative' : 'Aggressive'}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 mt-2">
              {sentinelMode === 'aggressive' ? 'Trades on PRIORITY+ signals, confidence > 50' : 'Only trades on FLASH signals, confidence > 70'}
            </p>
          </div>

          <div className="glass-card p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">Session Key</h3>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${sessionActive ? 'bg-green-500' : 'bg-zinc-600'}`}/>
              <span className="text-xs text-zinc-500">
                {sessionPending ? 'Confirming...' : sessionActive
                  ? `Active | ${sessionRemaining.toFixed(4)} ETH | ${new Date(sessionExpiry * 1000).toLocaleTimeString()}`
                  : 'No active session'}
              </span>
            </div>
            {isConnected && !sessionActive && (
              <button onClick={handleEnableAutoTrading} disabled={sessionPending}
                className="mt-2 w-full text-xs bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/20 text-violet-300 py-2 rounded-lg transition-colors disabled:opacity-50">
                {sessionPending ? 'Signing...' : 'Enable Auto Trading'}
              </button>
            )}
            {sessionActive && (
              <button onClick={handleRevokeSession}
                className="mt-2 w-full text-xs bg-red-600/20 hover:bg-red-600/30 border border-red-500/20 text-red-300 py-2 rounded-lg transition-colors">
                Revoke Session
              </button>
            )}
          </div>

          {/* VPS Status */}
          <div className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">VPS Status</h3>
              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-400"/><span className="text-[9px] text-green-400">Online</span></div>
            </div>
            <div className="space-y-1 text-[10px] text-zinc-600">
              <div className="flex justify-between"><span>Data sources</span><span>27 active</span></div>
              <div className="flex justify-between"><span>Scan interval</span><span>15 min</span></div>
            </div>
          </div>
        </>}
      </div>
    </div>
  )
}
