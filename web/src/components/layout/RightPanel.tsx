'use client'

import { useEffect, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi'
import { parseEther } from 'viem'
import { base } from 'wagmi/chains'

interface PortfolioData {
  weth: { formatted: string }
  usdc: { formatted: string }
  eth: { formatted: string }
  price: number
  totalValueUSD: string
}

interface SignalData {
  macro_risk_score: number
  crypto_sentiment: number
  technical_bias: string
  recommended_action: string
  briefing?: string
  alerts?: Array<{ level: string; signal: string; source: string }>
}

const SESSION_MANAGER = '0x5810d1A3DAEfe21fB266aB00Ec74ca628637550e' as `0x${string}`
const EXECUTOR = '0x0309dc91bB89750C317Ec69566bAF1613b57e6bB' as `0x${string}` // AI backend wallet
const SESSION_ABI = [
  { type: 'function', name: 'createSession', inputs: [{ name: 'executor', type: 'address' }, { name: 'maxPerTrade', type: 'uint256' }, { name: 'totalBudget', type: 'uint256' }, { name: 'duration', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeSession', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const

export function RightPanel() {
  const { isConnected, address } = useAccount()
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [signals, setSignals] = useState<SignalData | null>(null)
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionPending, setSessionPending] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()

  async function handleEnableAutoTrading() {
    if (!isConnected) return
    setSessionPending(true)
    try {
      // Force switch to Base
      try { await switchChainAsync({ chainId: base.id }) } catch {}

      await writeContractAsync({
        address: SESSION_MANAGER,
        abi: SESSION_ABI,
        functionName: 'createSession',
        args: [
          EXECUTOR,
          parseEther('0.005'),
          parseEther('0.02'),
          BigInt(86400),
        ],
        chainId: base.id,
      })
      setSessionActive(true)
    } catch (err) {
      console.error('Session creation failed:', err)
    }
    setSessionPending(false)
  }

  async function handleRevokeSession() {
    try {
      try { await switchChainAsync({ chainId: base.id }) } catch {}
      await writeContractAsync({
        address: SESSION_MANAGER,
        abi: SESSION_ABI,
        functionName: 'revokeSession',
        chainId: base.id,
      })
      setSessionActive(false)
    } catch (err) {
      console.error('Session revoke failed:', err)
    }
  }

  useEffect(() => {
    if (!isConnected) return
    fetchPortfolio()
    fetchSignals()
    const i1 = setInterval(fetchPortfolio, 30000)
    const i2 = setInterval(fetchSignals, 60000)
    return () => { clearInterval(i1); clearInterval(i2) }
  }, [isConnected])

  async function fetchPortfolio() {
    try {
      const r = await fetch('/api/portfolio')
      if (r.ok) setPortfolio(await r.json())
    } catch {}
  }

  async function fetchSignals() {
    try {
      const r = await fetch('/api/signals')
      if (r.ok) setSignals(await r.json())
    } catch {}
  }

  const riskColor = (v: number) => v > 70 ? 'text-red-400' : v > 40 ? 'text-yellow-400' : 'text-green-400'
  const sentColor = (v: number) => v > 60 ? 'text-green-400' : v > 40 ? 'text-zinc-400' : 'text-red-400'

  return (
    <div className="w-[360px] h-full glass border-l border-white/[0.06] flex flex-col overflow-hidden">
      {/* Wallet + Total */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <ConnectKitButton />
        </div>
        {isConnected && portfolio && (
          <div>
            <p className="text-2xl font-semibold">${portfolio.totalValueUSD}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Total Balance on Base</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Token List */}
        <div className="glass-card p-4">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Assets</h3>
          {isConnected && portfolio ? (
            <div className="space-y-1">
              {/* ETH */}
              {(() => {
                const ethBal = Number(portfolio.eth.formatted)
                const ethUsd = ethBal * (portfolio.price || 0)
                return (
                  <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[#627EEA]/20 flex items-center justify-center text-xs font-bold text-[#627EEA]">E</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <span className="text-sm font-medium">Ethereum</span>
                        <span className="text-sm font-mono">${ethUsd.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-zinc-500">{ethBal.toFixed(4)} ETH</span>
                        <span className="text-xs text-zinc-500">${portfolio.price?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* USDC */}
              {(() => {
                const usdcBal = Number(portfolio.usdc.formatted)
                return (
                  <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[#2775CA]/20 flex items-center justify-center text-xs font-bold text-[#2775CA]">$</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <span className="text-sm font-medium">USD Coin</span>
                        <span className="text-sm font-mono">${usdcBal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-zinc-500">{usdcBal.toFixed(3)} USDC</span>
                        <span className="text-xs text-green-500">+0.01%</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* WETH */}
              {(() => {
                const wethBal = Number(portfolio.weth.formatted)
                const wethUsd = wethBal * (portfolio.price || 0)
                return wethBal > 0 ? (
                  <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[#EC4899]/20 flex items-center justify-center text-[10px] font-bold text-[#EC4899]">W</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <span className="text-sm font-medium">Wrapped Ether</span>
                        <span className="text-sm font-mono">${wethUsd.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-zinc-500">{wethBal.toFixed(6)} WETH</span>
                        <span className="text-xs text-zinc-500">${portfolio.price?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ) : null
              })()}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">{isConnected ? 'Loading...' : 'Connect wallet'}</p>
          )}
        </div>

        {/* Signals */}
        <div className="glass-card p-4">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Market Intelligence</h3>
          {signals ? (
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-500">Macro Risk</span>
                <span className={`text-sm font-mono ${riskColor(signals.macro_risk_score)}`}>
                  {signals.macro_risk_score}/100
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-500">Sentiment</span>
                <span className={`text-sm font-mono ${sentColor(signals.crypto_sentiment)}`}>
                  {signals.crypto_sentiment}/100
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-500">Bias</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  signals.technical_bias === 'long' ? 'bg-green-500/15 text-green-400' :
                  signals.technical_bias === 'short' ? 'bg-red-500/15 text-red-400' :
                  'bg-zinc-500/15 text-zinc-400'
                }`}>
                  {signals.technical_bias}
                </span>
              </div>

              {signals.briefing && (
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <p className="text-xs text-zinc-400 leading-relaxed">{signals.briefing}</p>
                </div>
              )}

              {signals.alerts && signals.alerts.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {signals.alerts.slice(0, 3).map((a, i) => (
                    <div key={i} className={`text-[10px] px-2 py-1.5 rounded-lg ${
                      a.level === 'FLASH' ? 'bg-red-500/10 text-red-300 border border-red-500/20' :
                      a.level === 'PRIORITY' ? 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20' :
                      'bg-zinc-800/50 text-zinc-500'
                    }`}>
                      {a.signal}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">Connecting to VPS...</p>
          )}
        </div>

        {/* Session Key Status */}
        <div className="glass-card p-4">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Session Key</h3>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${sessionActive ? 'bg-green-500' : 'bg-zinc-600'}`} />
            <span className="text-xs text-zinc-500">
              {sessionPending ? 'Confirming...' : sessionActive ? 'Active (24h, 0.02 ETH budget)' : 'No active session'}
            </span>
          </div>
          {isConnected && !sessionActive && (
            <button
              onClick={handleEnableAutoTrading}
              disabled={sessionPending}
              className="mt-3 w-full text-xs bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/20 text-violet-300 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {sessionPending ? 'Waiting for signature...' : 'Enable Auto Trading'}
            </button>
          )}
          {sessionActive && (
            <button
              onClick={handleRevokeSession}
              className="mt-3 w-full text-xs bg-red-600/20 hover:bg-red-600/30 border border-red-500/20 text-red-300 py-2 rounded-lg transition-colors"
            >
              Revoke Session
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
