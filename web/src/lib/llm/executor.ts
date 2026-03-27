import { getPrice } from '@/lib/chain/price'
import { getPortfolio } from '@/lib/chain/portfolio'
import { marketSwap } from '@/lib/chain/swap'
import { setStopLoss, setTakeProfit } from '@/lib/chain/stop-order'
import { getActiveOrders, getAllOrders, getOrder, trackOrder, cancelOrder } from '@/lib/chain/event-indexer'
import { writeMemory } from '@/lib/memory'
import { getSession, sessionSwap } from '@/lib/chain/session'
import { getAccount, getWalletClient, ADDRESSES, ERC20_ABI, publicClient } from '@/lib/chain/config'

const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'get_market_signals': {
        try {
          const res = await fetch(`${VPS_API}/api/signals`, { signal: AbortSignal.timeout(5000) })
          if (res.ok) return JSON.stringify(await res.json())
        } catch {
          // VPS not available
        }
        return JSON.stringify({
          timestamp: new Date().toISOString(),
          macro_risk_score: 45,
          crypto_sentiment: 65,
          alerts: [{ level: 'ROUTINE', signal: 'No major macro events detected', relevance: 30 }],
          technical_bias: 'neutral',
          recommended_action: 'hold',
          note: 'VPS data pipeline not connected.',
        })
      }

      case 'get_price': {
        const { price, reserve0, reserve1 } = await getPrice()
        return JSON.stringify({
          pair: 'WETH/USDC',
          price,
          price_formatted: `$${price.toLocaleString()}`,
          reserve_weth: (Number(reserve0) / 1e18).toFixed(2),
          reserve_usdc: (Number(reserve1) / 1e6).toFixed(2),
        })
      }

      case 'get_portfolio': {
        const portfolio = await getPortfolio()
        return JSON.stringify({
          address: portfolio.address,
          weth: portfolio.weth.formatted + ' WETH',
          usdc: portfolio.usdc.formatted + ' USDC',
          eth_gas: portfolio.eth.formatted + ' ETH',
        })
      }

      case 'market_swap': {
        const result = await marketSwap(args.direction as 'buy' | 'sell', args.amount as string)
        return JSON.stringify(result)
      }

      case 'set_stop_loss': {
        const result = await setStopLoss(args.amount as string, args.threshold as number)
        trackOrder({
          pair: ADDRESSES.WETH_USDC_PAIR,
          client: getAccount().address,
          isStopLoss: true,
          threshold: args.threshold as number,
          amount: args.amount as string,
        })
        return JSON.stringify(result)
      }

      case 'set_take_profit': {
        const result = await setTakeProfit(args.amount as string, args.threshold as number)
        trackOrder({
          pair: ADDRESSES.WETH_USDC_PAIR,
          client: getAccount().address,
          isStopLoss: false,
          threshold: args.threshold as number,
          amount: args.amount as string,
        })
        return JSON.stringify(result)
      }

      case 'get_active_orders': {
        const active = getActiveOrders()
        const all = getAllOrders()
        return JSON.stringify({
          active_count: active.length,
          total_count: all.length,
          orders: active.map(o => ({
            orderId: o.orderId,
            type: o.isStopLoss ? 'stop_loss' : 'take_profit',
            threshold: o.threshold,
            amount: o.amountIn,
            status: o.status,
          })),
          recent_executed: all.filter(o => o.status === 'executed').slice(-5).map(o => ({
            orderId: o.orderId,
            type: o.isStopLoss ? 'stop_loss' : 'take_profit',
            amountOut: o.amountOut,
            txHash: o.executedTxHash,
          })),
        })
      }

      case 'cancel_order': {
        const orderId = args.orderId as number
        const order = getOrder(orderId)
        if (!order) return JSON.stringify({ error: `Order ${orderId} not found` })
        if (order.status !== 'active') return JSON.stringify({ error: `Order ${orderId} is ${order.status}, not active` })

        // Revoke allowance to callback contract (set to 0)
        const walletClient = getWalletClient()
        const txHash = await walletClient.writeContract({
          address: ADDRESSES.WETH,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ADDRESSES.CALLBACK, 0n],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        // Mark order as cancelled in index
        cancelOrder(orderId)

        return JSON.stringify({
          success: true,
          orderId,
          txHash,
          note: 'Allowance revoked. Reactive contract cannot execute without approval.',
        })
      }

      case 'get_session': {
        const session = await getSession()
        return JSON.stringify({
          ...session,
          expiry_formatted: new Date(session.expiry * 1000).toISOString(),
          note: session.active && !session.expired
            ? `Session active. AI can trade up to ${session.remaining} remaining.`
            : 'No active session. User needs to create one to enable auto trading.',
        })
      }

      case 'session_swap': {
        const wallet = getAccount().address
        const result = await sessionSwap(wallet, args.direction as 'buy' | 'sell', args.amount as string)
        return JSON.stringify(result)
      }

      case 'update_memory': {
        const wallet = getAccount().address
        writeMemory(wallet, args.section as 'profile' | 'patterns' | 'decisions', args.content as string)
        return JSON.stringify({ success: true, section: args.section, note: 'Memory updated' })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (error) {
    return JSON.stringify({ error: String(error) })
  }
}
