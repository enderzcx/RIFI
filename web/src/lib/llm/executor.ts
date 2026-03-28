import { getPrice } from '@/lib/chain/price'
import { getPortfolio } from '@/lib/chain/portfolio'
import { marketSwap, buildSwapTxs } from '@/lib/chain/swap'
import { setStopLoss, setTakeProfit, buildStopLossTxs } from '@/lib/chain/stop-order'
import { getActiveOrders, getAllOrders, getOrder, trackOrder, cancelOrder } from '@/lib/chain/event-indexer'
import { writeMemory } from '@/lib/memory'
import { getSession, sessionSwap } from '@/lib/chain/session'
import { getAccount, getWalletClient, ADDRESSES, ERC20_ABI, ORDER_REGISTRY_ABI, publicClient } from '@/lib/chain/config'

const VPS_API = process.env.VPS_API_URL || 'http://localhost:3200'

// userAddress: connected wallet from frontend. If provided, reads use it.
// For writes: if userAddress === server wallet → execute directly. Otherwise → return sign_request.
export async function executeTool(name: string, args: Record<string, unknown>, userAddress?: string): Promise<string> {
  const serverWallet = getAccount().address
  const wallet = userAddress || serverWallet
  const isServerWallet = wallet.toLowerCase() === serverWallet.toLowerCase()

  // Check if user has an active session — if yes, server can execute on their behalf
  let hasSession = isServerWallet // server wallet always has "implicit session"
  if (!isServerWallet) {
    try {
      const session = await getSession(wallet)
      hasSession = session.active && !session.expired
    } catch {}
  }
  const canServerExecute = isServerWallet || hasSession

  try {
    switch (name) {
      case 'get_market_signals': {
        try {
          const res = await fetch(`${VPS_API}/api/signals`, { signal: AbortSignal.timeout(5000) })
          if (res.ok) return JSON.stringify(await res.json())
        } catch {}
        return JSON.stringify({
          timestamp: new Date().toISOString(),
          macro_risk_score: 45, crypto_sentiment: 65,
          alerts: [{ level: 'ROUTINE', signal: 'VPS not connected', relevance: 30 }],
          technical_bias: 'neutral', recommended_action: 'hold',
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
          // Has session or is server wallet: execute directly
          const result = await marketSwap(dir, args.amount as string)
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
          // Server deploys reactive contract with client=user's wallet
          const result = await setStopLoss(args.amount as string, args.threshold as number, wallet)
          trackOrder({ pair: ADDRESSES.WETH_USDC_PAIR, client: wallet, isStopLoss: true, threshold: args.threshold as number, amount: args.amount as string })
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
          trackOrder({ pair: ADDRESSES.WETH_USDC_PAIR, client: wallet, isStopLoss: false, threshold: args.threshold as number, amount: args.amount as string })
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
        const dir = args.direction as 'buy' | 'sell'
        const amt = parseFloat(args.amount as string)
        if (dir === 'sell' && amt < 0.001) return JSON.stringify({ error: `Amount ${amt} WETH too small (minimum 0.001).` })
        if (dir === 'buy' && amt < 2) return JSON.stringify({ error: `Amount ${amt} USDC too small (minimum 2 USDC).` })
        // session_swap always uses server wallet as executor, but operates on user's session
        const result = await sessionSwap(wallet, dir, args.amount as string)
        return JSON.stringify(result)
      }

      case 'update_memory': {
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
