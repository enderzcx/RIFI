import { publicClient, ADDRESSES, ORDER_REGISTRY_ABI } from '@/lib/chain/config'
import { formatEther } from 'viem'

// Also keep in-memory orders as fallback (for simple deployments without OrderRegistry)
import { getActiveOrders, getAllOrders } from '@/lib/chain/event-indexer'

interface OnChainOrder {
  orderId: number
  pair: string
  client: string
  isStopLoss: boolean
  threshold: number
  amount: string
  linkedOrderId: number
  active: boolean
  reactiveContract: string
}

export async function GET(req: Request) {
  const walletFilter = new URL(req.url).searchParams.get('wallet')?.toLowerCase()
  const registryAddr = ADDRESSES.ORDER_REGISTRY

  // If no OrderRegistry deployed, fallback to in-memory
  if (registryAddr === '0x0000000000000000000000000000000000000000') {
    const active = getActiveOrders()
    const all = getAllOrders()
    return Response.json({
      source: 'memory',
      active: active,
      recent: all.filter(o => o.status !== 'active').slice(-10),
    })
  }

  // Read from chain
  try {
    const nextId = await publicClient.readContract({
      address: registryAddr,
      abi: ORDER_REGISTRY_ABI,
      functionName: 'nextOrderId',
    }) as bigint

    const total = Number(nextId)
    if (total <= 1) {
      return Response.json({ source: 'chain', active: [], recent: [] })
    }

    // Read all orders (batch multicall for efficiency)
    const calls = []
    for (let i = 1; i < total && i < 50; i++) { // cap at 50 orders
      calls.push({
        address: registryAddr,
        abi: ORDER_REGISTRY_ABI,
        functionName: 'orders',
        args: [BigInt(i)],
      } as const)
    }

    const results = await publicClient.multicall({ contracts: calls })

    const orders: OnChainOrder[] = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status !== 'success' || !r.result) continue

      const data = r.result as [string, string, string, boolean, boolean, bigint, bigint, bigint, bigint, boolean]
      const [reactiveContract, pair, client, isStopLoss, , , threshold, amount, linkedOrderId, active] = data

      // Skip empty orders
      if (client === '0x0000000000000000000000000000000000000000') continue

      orders.push({
        orderId: i + 1,
        pair,
        client,
        isStopLoss,
        threshold: Number(threshold), // raw USD price integer (e.g. 2120 = $2,120)
        amount: formatEther(amount),
        linkedOrderId: Number(linkedOrderId),
        active,
        reactiveContract,
      })
    }

    const filtered = walletFilter ? orders.filter(o => o.client.toLowerCase() === walletFilter) : orders
    const active = filtered.filter(o => o.active)
    const recent = filtered.filter(o => !o.active).slice(-10)

    return Response.json({ source: 'chain', active, recent })
  } catch (err) {
    // Fallback to memory on error
    console.error('[Orders] Chain read failed, falling back to memory:', err)
    const active = getActiveOrders()
    const all = getAllOrders()
    return Response.json({
      source: 'memory_fallback',
      active,
      recent: all.filter(o => o.status !== 'active').slice(-10),
    })
  }
}
