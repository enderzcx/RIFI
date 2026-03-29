'use client'

import { ToolResult } from '@/lib/types'
import {
  DollarSign, Briefcase, Radio, ClipboardList,
  ArrowLeftRight, ShieldAlert, Target, KeyRound,
  Bot, Brain, Wrench, ExternalLink, Check,
  Newspaper, Globe, Activity
} from 'lucide-react'

export function ToolCallCard({ tool, result }: ToolResult) {
  const r = result as Record<string, unknown> | null
  if (!r) return null

  switch (tool) {
    case 'get_price':
      return (
        <Card icon={<DollarSign />} color="blue"
          label={`ETH ${r.price_formatted}`}
          sub={`Pool: ${r.reserve_weth} WETH / ${r.reserve_usdc} USDC`} />
      )

    case 'get_portfolio':
      return (
        <Card icon={<Briefcase />} color="emerald"
          label="Portfolio loaded"
          sub={`${r.weth} | ${r.usdc} | ${r.eth_gas} gas`} />
      )

    case 'get_market_signals': {
      const s = r as Record<string, unknown>
      return (
        <Card icon={<Radio />} color="violet"
          label={`Risk ${s.macro_risk_score}/100 | Sentiment ${s.crypto_sentiment}/100`}
          sub={`Bias: ${s.technical_bias} | Action: ${s.recommended_action}`} />
      )
    }

    case 'get_active_orders':
      return (
        <Card icon={<ClipboardList />} color="zinc"
          label={`${r.active_count} active orders`}
          sub={`${r.total_count} total`} />
      )

    case 'market_swap':
      return (
        <CardTx icon={<ArrowLeftRight />} color="cyan"
          label={`Swapped ${r.amountIn} → ${r.amountOut}`}
          txHash={r.txHash as string} />
      )

    case 'set_stop_loss':
      return (
        <CardTx icon={<ShieldAlert />} color="red"
          label={`Stop Loss: ${r.amount} @ $${r.threshold}`}
          txHash={r.reactiveTxHash as string || r.txHash as string}
          chain="reactive" />
      )

    case 'set_take_profit':
      return (
        <CardTx icon={<Target />} color="green"
          label={`Take Profit: ${r.amount} @ $${r.threshold}`}
          txHash={r.reactiveTxHash as string || r.txHash as string}
          chain="reactive" />
      )

    case 'get_session': {
      const s = r as Record<string, unknown>
      return s.active ? (
        <Card icon={<KeyRound />} color="amber"
          label={`Session active | ${s.remaining} remaining`}
          sub={`Expires: ${s.expiry_formatted}`} />
      ) : (
        <Card icon={<KeyRound />} color="zinc"
          label="No active session"
          sub="Enable auto trading to start" />
      )
    }

    case 'session_swap':
      return (
        <CardTx icon={<Bot />} color="violet"
          label={`Auto swap: ${r.amountIn} → ${r.amountOut}`}
          txHash={r.txHash as string} />
      )

    case 'update_memory':
      return <Card icon={<Brain />} color="pink" label="Memory updated" sub={String(r.section)} />

    case 'get_crypto_news': {
      const items = Array.isArray(r) ? r : []
      return <Card icon={<Newspaper />} color="amber" label={`${items.length} crypto news loaded`} sub="OpenNews (6551.io)" />
    }

    case 'get_crucix_data': {
      const m = (r as Record<string, unknown>).markets as Record<string, number> | undefined
      return <Card icon={<Globe />} color="blue" label="Crucix 27-source data" sub={m ? `BTC $${m.btc?.toLocaleString()} | VIX ${m.vix}` : 'Loaded'} />
    }

    case 'get_onchain_data':
      return <Card icon={<Activity />} color="cyan" label={`${(r as Record<string, unknown>).token || 'Token'} on-chain data`} sub={(r as Record<string, unknown>).source as string || 'OnchainOS'} />

    default:
      return <Card icon={<Wrench />} color="zinc" label={tool} sub="completed" />
  }
}

const COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  blue:    { bg: 'bg-blue-500/8',    border: 'border-blue-500/20',    icon: 'text-blue-400'    },
  emerald: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', icon: 'text-emerald-400' },
  violet:  { bg: 'bg-violet-500/8',  border: 'border-violet-500/20',  icon: 'text-violet-400'  },
  cyan:    { bg: 'bg-cyan-500/8',    border: 'border-cyan-500/20',    icon: 'text-cyan-400'    },
  red:     { bg: 'bg-red-500/8',     border: 'border-red-500/20',     icon: 'text-red-400'     },
  green:   { bg: 'bg-green-500/8',   border: 'border-green-500/20',   icon: 'text-green-400'   },
  amber:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/20',   icon: 'text-amber-400'   },
  pink:    { bg: 'bg-pink-500/8',    border: 'border-pink-500/20',    icon: 'text-pink-400'    },
  zinc:    { bg: 'bg-zinc-500/8',    border: 'border-zinc-500/20',    icon: 'text-zinc-400'    },
}

function Card({ icon, color, label, sub }: { icon: React.ReactNode; color: string; label: string; sub?: string }) {
  const c = COLORS[color] || COLORS.zinc
  return (
    <div className={`flex items-center gap-3 ${c.bg} border ${c.border} rounded-xl px-3.5 py-2.5 my-1 transition-colors`}>
      <div className={`${c.icon} shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-zinc-200 font-medium leading-snug">{label}</p>
        {sub && <p className="text-[11px] text-zinc-500 leading-snug mt-0.5 truncate">{sub}</p>}
      </div>
      <Check className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
    </div>
  )
}

function CardTx({ icon, color, label, txHash, chain = 'base' }: { icon: React.ReactNode; color: string; label: string; txHash?: string; chain?: 'base' | 'reactive' }) {
  const c = COLORS[color] || COLORS.zinc
  const explorerUrl = chain === 'reactive'
    ? `https://kopli.reactscan.net/tx/${txHash}`
    : `https://basescan.org/tx/${txHash}`
  return (
    <div className={`flex items-center gap-3 ${c.bg} border ${c.border} rounded-xl px-3.5 py-2.5 my-1 transition-colors`}>
      <div className={`${c.icon} shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-zinc-200 font-medium leading-snug">{label}</p>
      </div>
      {txHash && txHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors shrink-0"
        >
          TX <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}
