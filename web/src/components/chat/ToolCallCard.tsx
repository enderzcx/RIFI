'use client'

import { ToolResult } from '@/lib/types'

export function ToolCallCard({ tool, result }: ToolResult) {
  const r = result as Record<string, unknown> | null
  if (!r) return null

  switch (tool) {
    case 'get_price':
      return (
        <Chip icon="💲" label={`ETH ${r.price_formatted}`} sub={`Pool: ${r.reserve_weth} WETH / ${r.reserve_usdc} USDC`} />
      )

    case 'get_portfolio':
      return (
        <Chip icon="💼" label="Portfolio loaded" sub={`${r.weth} | ${r.usdc} | ${r.eth_gas} gas`} />
      )

    case 'get_market_signals': {
      const signals = r as Record<string, unknown>
      const bias = String(signals.technical_bias || 'neutral')
      const action = String(signals.recommended_action || 'hold')
      return (
        <Chip
          icon="📡"
          label={`Risk ${signals.macro_risk_score}/100 | Sentiment ${signals.crypto_sentiment}/100`}
          sub={`Bias: ${bias} | Action: ${action}`}
        />
      )
    }

    case 'get_active_orders':
      return (
        <Chip icon="📋" label={`${r.active_count} active orders`} sub={`${r.total_count} total`} />
      )

    case 'market_swap':
      return (
        <ChipTx icon="🔄" label={`Swapped ${r.amountIn} → ${r.amountOut}`} txHash={r.txHash as string} />
      )

    case 'set_stop_loss':
      return (
        <ChipTx icon="🛑" label={`Stop Loss: ${r.amount} @ $${r.threshold}`} txHash={r.txHash as string} />
      )

    case 'set_take_profit':
      return (
        <ChipTx icon="🎯" label={`Take Profit: ${r.amount} @ $${r.threshold}`} txHash={r.txHash as string} />
      )

    case 'get_session': {
      const s = r as Record<string, unknown>
      return s.active ? (
        <Chip icon="🔑" label={`Session active | ${s.remaining} remaining`} sub={`Expires: ${s.expiry_formatted}`} />
      ) : (
        <Chip icon="🔑" label="No active session" sub="Enable auto trading to start" />
      )
    }

    case 'session_swap':
      return (
        <ChipTx icon="🤖" label={`Auto swap: ${r.amountIn} → ${r.amountOut}`} txHash={r.txHash as string} />
      )

    case 'update_memory':
      return <Chip icon="🧠" label="Memory updated" sub={String(r.section)} />

    default:
      return <Chip icon="🔧" label={tool} sub="completed" />
  }
}

function Chip({ icon, label, sub }: { icon: string; label: string; sub?: string }) {
  return (
    <div className="inline-flex items-center gap-2 bg-zinc-800/60 border border-white/[0.06] rounded-lg px-3 py-1.5 my-0.5">
      <span className="text-sm">{icon}</span>
      <div>
        <span className="text-xs text-zinc-300">{label}</span>
        {sub && <span className="text-[10px] text-zinc-500 ml-2">{sub}</span>}
      </div>
    </div>
  )
}

function ChipTx({ icon, label, txHash }: { icon: string; label: string; txHash?: string }) {
  return (
    <div className="inline-flex items-center gap-2 bg-zinc-800/60 border border-white/[0.06] rounded-lg px-3 py-1.5 my-0.5">
      <span className="text-sm">{icon}</span>
      <span className="text-xs text-zinc-300">{label}</span>
      {txHash && txHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
        <a
          href={`https://basescan.org/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-400 hover:underline ml-1"
        >
          View TX
        </a>
      )}
    </div>
  )
}
