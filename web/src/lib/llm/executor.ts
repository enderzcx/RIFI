import { getPrice } from '@/lib/chain/price'
import { getPortfolio } from '@/lib/chain/portfolio'
import { marketSwap, buildSwapTxs } from '@/lib/chain/swap'
import { setStopLoss, setTakeProfit, buildStopLossTxs } from '@/lib/chain/stop-order'
import { getActiveOrders, getAllOrders, getOrder, trackOrder, cancelOrder } from '@/lib/chain/event-indexer'
import { writeMemory, type AnySection } from '@/lib/memory'
import { getSession, sessionSwap } from '@/lib/chain/session'
import { getAccount, getWalletClient, ADDRESSES, ERC20_ABI, ORDER_REGISTRY_ABI, publicClient } from '@/lib/chain/config'
import { runHooks, isWriteTool } from '@/lib/hooks'
import type { PreTradeContext, PostTradeContext } from '@/lib/hooks'

const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

// --- Trade & Decision Recording ---
async function recordTrade(trade: Record<string, unknown>) {
  try { await fetch(`${VPS_API}/api/trades`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade), signal: AbortSignal.timeout(5000) }) } catch {}
}
async function recordDecision(decision: Record<string, unknown>) {
  try { await fetch(`${VPS_API}/api/decisions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decision), signal: AbortSignal.timeout(5000) }) } catch {}
}

// userAddress: connected wallet from frontend. If provided, reads use it.
// For writes: if userAddress === server wallet → execute directly. Otherwise → return sign_request.
export async function executeTool(name: string, args: Record<string, unknown>, userAddress?: string): Promise<string> {
  const serverWallet = getAccount().address
  const wallet = userAddress || serverWallet
  const isServerWallet = wallet.toLowerCase() === serverWallet.toLowerCase()

  // Check if user has an active session — if yes, server can execute on their behalf
  let hasSession = isServerWallet // server wallet always has "implicit session"
  let sessionData: { maxPerTrade: string; remaining: string; active: boolean; expired: boolean } | undefined
  if (!isServerWallet) {
    try {
      const session = await getSession(wallet)
      hasSession = session.active && !session.expired
      sessionData = { maxPerTrade: session.maxPerTrade, remaining: session.remaining, active: session.active, expired: session.expired }
    } catch {}
  }
  const canServerExecute = isServerWallet || hasSession

  // --- Pre-trade hook ---
  if (isWriteTool(name) && canServerExecute) {
    let portfolio: PreTradeContext['portfolio']
    try {
      const p = await getPortfolio(wallet)
      portfolio = {
        weth: parseFloat(p.weth.formatted),
        usdc: parseFloat(p.usdc.formatted),
        eth: parseFloat(p.eth.formatted),
      }
    } catch {}

    let price: number | undefined
    try {
      const pr = await getPrice()
      price = pr.price
    } catch {}

    const preCtx: PreTradeContext = {
      tool: name, args, wallet, isServerWallet, hasSession, canServerExecute,
      price, portfolio, session: sessionData,
    }
    const preResult = await runHooks('pre-trade', preCtx)
    if (!preResult.allow) {
      return JSON.stringify({ error: `[Hook blocked] ${preResult.reason}`, hook: true })
    }
  }

  const _startTime = Date.now()

  try {
    switch (name) {
      case 'get_market_signals': {
        const mode = (args.mode as string) === 'stock' ? 'stock' : 'crypto'
        try {
          const res = await fetch(`${VPS_API}/api/signals?mode=${mode}`, { signal: AbortSignal.timeout(5000) })
          if (res.ok) return JSON.stringify(await res.json())
        } catch {}
        return JSON.stringify({
          timestamp: new Date().toISOString(),
          macro_risk_score: 45, crypto_sentiment: 65, stock_sentiment: 50,
          alerts: [{ level: 'ROUTINE', signal: 'VPS not connected', relevance: 30 }],
          technical_bias: 'neutral', recommended_action: 'hold', mode,
        })
      }

      case 'get_price': {
        const { price, reserve0, reserve1 } = await getPrice()
        return JSON.stringify({
          pair: 'WETH/USDC', price,
          price_formatted: `$${price.toLocaleString()}`,
          reserve_weth: (Number(reserve0) / 1e18).toFixed(2),
          reserve_usdc: (Number(reserve1) / 1e6).toFixed(2),
        })
      }

      case 'get_portfolio': {
        const portfolio = await getPortfolio(wallet)
        return JSON.stringify({
          address: portfolio.address,
          weth: portfolio.weth.formatted + ' WETH',
          usdc: portfolio.usdc.formatted + ' USDC',
          eth_gas: portfolio.eth.formatted + ' ETH',
        })
      }

      case 'market_swap': {
        const dir = args.direction as 'buy' | 'sell'
        const amt = parseFloat(args.amount as string)
        if (dir === 'sell' && amt < 0.001) return JSON.stringify({ error: `Amount ${amt} WETH too small (minimum 0.001)` })
        if (dir === 'buy' && amt < 2) return JSON.stringify({ error: `Amount ${amt} USDC too small (minimum 2 USDC)` })

        if (canServerExecute) {
          const result = await marketSwap(dir, args.amount as string)
          const resultObj = result as Record<string, unknown>
          const tradeId = `market_${Date.now()}`
          const price = resultObj.price || resultObj.effectivePrice || 0
          recordTrade({ trade_id: tradeId, source: 'onchain', pair: 'WETH/USDC', side: dir, entry_price: price, amount: amt, amount_out: resultObj.amountOut || 0, tx_hash: resultObj.txHash || '', status: 'open' })
          // Post-trade hook
          await runHooks('post-trade', { tool: name, args, wallet, isServerWallet, hasSession, canServerExecute, result: resultObj, executionTimeMs: Date.now() - _startTime, success: !resultObj.error } as PostTradeContext).catch(() => {})
          return JSON.stringify(result)
        } else {
          // No session: return unsigned txs for MetaMask signing
          const { txs, expectedOutput } = await buildSwapTxs(dir, args.amount as string, wallet)
          return JSON.stringify({
            sign_request: true,
            txs,
            description: `Swap ${args.amount} ${dir === 'buy' ? 'USDC → WETH' : 'WETH → USDC'}`,
            expectedOutput,
          })
        }
      }

      case 'set_stop_loss': {
        if (canServerExecute) {
          const result = await setStopLoss(args.amount as string, args.threshold as number, wallet)
          const resultObj = result as Record<string, unknown>
          trackOrder({ pair: ADDRESSES.WETH_USDC_PAIR, client: wallet, isStopLoss: true, threshold: args.threshold as number, amount: args.amount as string })
          await runHooks('post-trade', { tool: name, args, wallet, isServerWallet, hasSession, canServerExecute, result: resultObj, executionTimeMs: Date.now() - _startTime, success: !resultObj.error } as PostTradeContext).catch(() => {})
          return JSON.stringify(result)
        } else {
          const { txs } = await buildStopLossTxs(args.amount as string, args.threshold as number, wallet, true)
          return JSON.stringify({
            sign_request: true,
            txs,
            description: `Set Stop Loss: ${args.amount} WETH @ $${args.threshold}`,
          })
        }
      }

      case 'set_take_profit': {
        if (canServerExecute) {
          const result = await setTakeProfit(args.amount as string, args.threshold as number, wallet)
          const resultObj = result as Record<string, unknown>
          trackOrder({ pair: ADDRESSES.WETH_USDC_PAIR, client: wallet, isStopLoss: false, threshold: args.threshold as number, amount: args.amount as string })
          await runHooks('post-trade', { tool: name, args, wallet, isServerWallet, hasSession, canServerExecute, result: resultObj, executionTimeMs: Date.now() - _startTime, success: !resultObj.error } as PostTradeContext).catch(() => {})
          return JSON.stringify(result)
        } else {
          const { txs } = await buildStopLossTxs(args.amount as string, args.threshold as number, wallet, false)
          return JSON.stringify({
            sign_request: true,
            txs,
            description: `Set Take Profit: ${args.amount} WETH @ $${args.threshold}`,
          })
        }
      }

      case 'get_active_orders': {
        const active = getActiveOrders()
        const all = getAllOrders()
        return JSON.stringify({
          active_count: active.length, total_count: all.length,
          orders: active.map(o => ({ orderId: o.orderId, type: o.isStopLoss ? 'stop_loss' : 'take_profit', threshold: o.threshold, amount: o.amountIn, status: o.status })),
          recent_executed: all.filter(o => o.status === 'executed').slice(-5).map(o => ({ orderId: o.orderId, type: o.isStopLoss ? 'stop_loss' : 'take_profit', amountOut: o.amountOut, txHash: o.executedTxHash })),
        })
      }

      case 'cancel_order': {
        const orderId = args.orderId as number
        const order = getOrder(orderId)
        if (!order) return JSON.stringify({ error: `Order ${orderId} not found` })
        if (order.status !== 'active') return JSON.stringify({ error: `Order ${orderId} is ${order.status}, not active` })

        if (isServerWallet) {
          const walletClient = getWalletClient()
          let txHash = '', method = ''
          if (ADDRESSES.ORDER_REGISTRY !== '0x0000000000000000000000000000000000000000') {
            const hash = await walletClient.writeContract({ address: ADDRESSES.ORDER_REGISTRY, abi: ORDER_REGISTRY_ABI, functionName: 'cancelOrder', args: [BigInt(orderId)] })
            await publicClient.waitForTransactionReceipt({ hash })
            txHash = hash; method = 'OrderRegistry.cancelOrder'
          } else {
            const currentAllowance = await publicClient.readContract({ address: ADDRESSES.WETH, abi: ERC20_ABI, functionName: 'allowance', args: [getAccount().address, ADDRESSES.CALLBACK] }) as bigint
            const orderAmount = BigInt(Math.floor(parseFloat(order.amountIn) * 1e18))
            const newAllowance = currentAllowance > orderAmount ? currentAllowance - orderAmount : 0n
            const hash = await walletClient.writeContract({ address: ADDRESSES.WETH, abi: ERC20_ABI, functionName: 'approve', args: [ADDRESSES.CALLBACK, newAllowance] })
            await publicClient.waitForTransactionReceipt({ hash })
            txHash = hash; method = 'Allowance reduced'
          }
          cancelOrder(orderId)
          return JSON.stringify({ success: true, orderId, txHash, method })
        } else {
          // For user wallet: revoke approval via sign_request
          return JSON.stringify({
            sign_request: true,
            txs: [{ to: ADDRESSES.WETH, data: '0x095ea7b3' + ADDRESSES.CALLBACK.slice(2).padStart(64, '0') + '0'.repeat(64), value: '0', description: `Revoke WETH approval for order #${orderId}` }],
            description: `Cancel order #${orderId}`,
          })
        }
      }

      case 'get_session': {
        const session = await getSession(wallet)
        return JSON.stringify({
          ...session,
          expiry_formatted: new Date(session.expiry * 1000).toISOString(),
          note: session.active && !session.expired
            ? `Session active. AI can trade up to ${session.remaining} remaining.`
            : 'No active session. User needs to create one to enable auto trading.',
        })
      }

      case 'session_swap': {
        if (!hasSession) return JSON.stringify({ error: 'No active session. User needs to create one to enable auto trading.' })
        const dir = args.direction as 'buy' | 'sell'
        const amt = parseFloat(args.amount as string)
        if (dir === 'sell' && amt < 0.001) return JSON.stringify({ error: `Amount ${amt} WETH too small (minimum 0.001).` })
        if (dir === 'buy' && amt < 2) return JSON.stringify({ error: `Amount ${amt} USDC too small (minimum 2 USDC).` })
        const result = await sessionSwap(wallet, dir, args.amount as string)
        const resultObj = result as Record<string, unknown>
        const tradeId = `session_${Date.now()}`
        const price = resultObj.price || resultObj.effectivePrice || 0
        recordTrade({ trade_id: tradeId, source: 'onchain', pair: 'WETH/USDC', side: dir, entry_price: price, amount: amt, amount_out: resultObj.amountOut || 0, tx_hash: resultObj.txHash || '', status: 'open' })
        // Post-trade hook
        await runHooks('post-trade', { tool: name, args, wallet, isServerWallet, hasSession, canServerExecute, result: resultObj, executionTimeMs: Date.now() - _startTime, success: !resultObj.error } as PostTradeContext).catch(() => {})
        return JSON.stringify(result)
      }

      case 'update_memory': {
        writeMemory(wallet, args.section as AnySection, args.content as string)
        return JSON.stringify({ success: true, section: args.section, note: 'Memory updated' })
      }

      case 'get_crypto_news': {
        const limit = (args.limit as number) || 10
        try {
          const res = await fetch(`${VPS_API}/api/news?limit=${Math.min(limit, 20)}`, { signal: AbortSignal.timeout(8000) })
          if (res.ok) {
            const raw = await res.json() as Array<Record<string, unknown>>
            const cleaned = raw.map((n) => ({
              title: n.text || n.title || '',
              summary: (n.aiRating as Record<string, unknown>)?.summary || '',
              score: (n.aiRating as Record<string, unknown>)?.score || 0,
              signal: (n.aiRating as Record<string, unknown>)?.signal || 'neutral',
              source: n.source || n.newsType || '',
              link: n.link || '',
              time: n.ts || '',
            }))
            return JSON.stringify(cleaned)
          }
        } catch {}
        return JSON.stringify({ error: 'News service unavailable' })
      }

      case 'get_crucix_data': {
        try {
          const res = await fetch(`${VPS_API}/api/crucix`, { signal: AbortSignal.timeout(8000) })
          if (res.ok) return JSON.stringify(await res.json())
        } catch {}
        return JSON.stringify({ error: 'Crucix data unavailable' })
      }

      case 'get_onchain_data': {
        const token = (args.token as string) || 'ETH'
        try {
          const res = await fetch(`${VPS_API}/api/crucix`, { signal: AbortSignal.timeout(5000) })
          if (res.ok) {
            const data = await res.json()
            const m = data.markets || {}
            return JSON.stringify({
              token,
              price_usd: token.toUpperCase() === 'BTC' ? m.btc : m.eth,
              vix: m.vix,
              sp500: m.sp500,
              gold: m.gold,
              energy: data.energy,
              conflicts: data.acled,
              source: 'Crucix + OnchainOS',
            })
          }
        } catch {}
        return JSON.stringify({ error: 'OnchainOS data unavailable' })
      }

      case 'bitget_trade': {
        const market = args.market as string
        const endpoint = market === 'futures' ? 'futures-order' : 'spot-order'
        try {
          const res = await fetch(`${VPS_API}/api/bitget/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol: args.symbol, side: args.side, amount: args.amount,
              orderType: args.order_type || 'market', price: args.price,
              leverage: args.leverage,
            }),
            signal: AbortSignal.timeout(15000),
          })
          return res.ok ? JSON.stringify(await res.json()) : JSON.stringify({ error: `Bitget ${endpoint} failed: ${res.status}` })
        } catch (e) { return JSON.stringify({ error: String(e) }) }
      }

      case 'bitget_account': {
        const action = args.action as string
        try {
          let url = `${VPS_API}/api/bitget/${action}`
          if (action === 'ticker' && args.symbol) url += `?symbol=${args.symbol}`
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
          return res.ok ? JSON.stringify(await res.json()) : JSON.stringify({ error: `Bitget ${action} failed` })
        } catch (e) { return JSON.stringify({ error: String(e) }) }
      }

      case 'lifi_swap': {
        try {
          const res = await fetch(`${VPS_API}/api/lifi-swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from_chain: args.from_chain,
              to_chain: args.to_chain,
              from_token: args.from_token,
              to_token: args.to_token,
              amount: args.amount,
            }),
            signal: AbortSignal.timeout(60000),
          })
          return res.ok ? JSON.stringify(await res.json()) : JSON.stringify({ error: `LiFi swap failed: ${res.status}` })
        } catch (e) {
          return JSON.stringify({ error: String(e) })
        }
      }

      case 'manage_strategy': {
        const action = args.action as string
        try {
          if (action === 'list') {
            const res = await fetch(`${VPS_API}/api/strategies?status=${(args.status as string) || 'active'}`, { signal: AbortSignal.timeout(5000) })
            return res.ok ? JSON.stringify(await res.json()) : JSON.stringify({ error: 'Failed to list strategies' })
          }
          if (action === 'create') {
            const res = await fetch(`${VPS_API}/api/strategies`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ goal: args.goal, template: args.template || 'custom', params_json: args.params }),
              signal: AbortSignal.timeout(5000),
            })
            return res.ok ? JSON.stringify(await res.json()) : JSON.stringify({ error: 'Failed to create strategy' })
          }
          if (action === 'update' || action === 'cancel') {
            const id = args.strategy_id as number
            if (!id) return JSON.stringify({ error: 'strategy_id required' })
            const body: Record<string, unknown> = {}
            if (action === 'cancel') body.status = 'cancelled'
            else if (args.status) body.status = args.status
            const res = await fetch(`${VPS_API}/api/strategies/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(5000),
            })
            return res.ok ? JSON.stringify(await res.json()) : JSON.stringify({ error: 'Failed to update strategy' })
          }
          return JSON.stringify({ error: `Unknown action: ${action}` })
        } catch (e) {
          return JSON.stringify({ error: String(e) })
        }
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (error) {
    // Post-trade hook on failure
    if (isWriteTool(name)) {
      const postCtx: PostTradeContext = {
        tool: name, args, wallet, isServerWallet, hasSession, canServerExecute,
        result: { error: String(error) }, executionTimeMs: Date.now() - _startTime, success: false,
      }
      await runHooks('post-trade', postCtx).catch(() => {})
    }
    return JSON.stringify({ error: String(error) })
  }
}
