// Event Indexer — monitors on-chain callback events, maintains order state
// Listens for Stop events from the BaseStopOrderCallback contract

import { publicClient, ADDRESSES } from './config'
import { pushService } from '@/lib/sse/push-service'
import { parseAbiItem } from 'viem'

export interface IndexedOrder {
  orderId: number
  pair: string
  client: string
  isStopLoss: boolean
  tokenSold: string
  amountIn: string
  amountOut: string
  status: 'active' | 'executed' | 'failed' | 'cancelled'
  createdAt: string
  executedTxHash?: string
  threshold?: number
}

// In-memory order index
const orders: Map<number, IndexedOrder> = new Map()
let nextOrderId = 0
let lastBlock = 0
let isPolling = false
let pollInterval: ReturnType<typeof setInterval> | null = null

export function getActiveOrders(): IndexedOrder[] {
  return Array.from(orders.values()).filter(o => o.status === 'active')
}

export function getAllOrders(): IndexedOrder[] {
  return Array.from(orders.values())
}

export function getOrder(orderId: number): IndexedOrder | undefined {
  return orders.get(orderId)
}

export function cancelOrder(orderId: number): boolean {
  const order = orders.get(orderId)
  if (!order || order.status !== 'active') return false
  order.status = 'cancelled' as IndexedOrder['status']
  pushService.broadcastAll({
    type: 'ORDER_CANCELLED',
    data: { orderId },
    timestamp: new Date().toISOString(),
  })
  return true
}

// Track orders created by our app (since the simple callback has no registry)
export function trackOrder(params: {
  pair: string
  client: string
  isStopLoss: boolean
  threshold: number
  amount: string
}): number {
  const id = nextOrderId++
  orders.set(id, {
    orderId: id,
    pair: params.pair,
    client: params.client,
    isStopLoss: params.isStopLoss,
    tokenSold: '',
    amountIn: params.amount,
    amountOut: '',
    status: 'active',
    createdAt: new Date().toISOString(),
    threshold: params.threshold,
  })

  pushService.broadcastAll({
    type: 'ORDER_CREATED',
    data: { orderId: id, isStopLoss: params.isStopLoss, threshold: params.threshold },
    timestamp: new Date().toISOString(),
  })

  return id
}

// Listen for Stop events from callback contract
const STOP_EVENT = parseAbiItem(
  'event Stop(address indexed pair, address indexed client, address indexed token, uint256[] tokens)'
)

export async function startEventIndexer(intervalMs = 15_000) {
  if (isPolling) return

  lastBlock = Number(await publicClient.getBlockNumber()) - 500 // ~15 min lookback
  isPolling = true

  pollEvents()
  pollInterval = setInterval(pollEvents, intervalMs)
  console.log(`[EventIndexer] Started from block ${lastBlock}`)
}

export function stopEventIndexer() {
  if (pollInterval) clearInterval(pollInterval)
  isPolling = false
}

async function pollEvents() {
  try {
    const currentBlock = Number(await publicClient.getBlockNumber())
    if (currentBlock <= lastBlock) return

    const fromBlock = BigInt(lastBlock + 1)
    const toBlock = BigInt(currentBlock)

    const stopLogs = await publicClient.getLogs({
      address: ADDRESSES.CALLBACK,
      event: STOP_EVENT,
      fromBlock,
      toBlock,
    })

    for (const log of stopLogs) {
      const pair = log.args.pair!
      const client = log.args.client!
      const tokens = log.args.tokens as bigint[] | undefined

      // Find matching active order
      for (const [id, order] of orders) {
        if (
          order.status === 'active' &&
          order.pair.toLowerCase() === pair.toLowerCase() &&
          order.client.toLowerCase() === client.toLowerCase()
        ) {
          order.status = 'executed'
          order.executedTxHash = log.transactionHash
          if (tokens && tokens.length > 1) {
            order.amountOut = tokens[1].toString()
          }

          pushService.broadcastAll({
            type: 'ORDER_EXECUTED',
            data: {
              orderId: id,
              amountOut: order.amountOut,
              txHash: log.transactionHash,
            },
            timestamp: new Date().toISOString(),
          })
          break
        }
      }
    }

    lastBlock = currentBlock
  } catch (err) {
    console.error('[EventIndexer] Poll error:', err)
  }
}
