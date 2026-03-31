// Event Indexer — monitors on-chain callback events, maintains order state
// Persists orders to disk via JsonStore (survives restarts)

import { publicClient, ADDRESSES } from './config'
import { pushService } from '@/lib/sse/push-service'
import { JsonStore } from '@/lib/tasks'
import { parseAbiItem } from 'viem'

export interface IndexedOrder {
  id: number        // JsonStore requires id field
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

// Persistent order store
const orderStore = new JsonStore<IndexedOrder>('orders.json')

// Derive next ID from existing orders
let nextOrderId = orderStore.getAll().reduce((max, o) => Math.max(max, o.orderId + 1), 0)
let lastBlock = 0
let isPolling = false
let pollInterval: ReturnType<typeof setInterval> | null = null

export function getActiveOrders(): IndexedOrder[] {
  return orderStore.filter(o => o.status === 'active')
}

export function getAllOrders(): IndexedOrder[] {
  return orderStore.getAll()
}

export function getOrder(orderId: number): IndexedOrder | undefined {
  return orderStore.get(orderId)
}

export function cancelOrder(orderId: number): boolean {
  const order = orderStore.get(orderId)
  if (!order || order.status !== 'active') return false
  orderStore.update(orderId, { status: 'cancelled' as IndexedOrder['status'] })
  pushService.broadcastAll({
    type: 'ORDER_CANCELLED',
    data: { orderId },
    timestamp: new Date().toISOString(),
  })
  return true
}

// Track orders created by our app
export function trackOrder(params: {
  pair: string
  client: string
  isStopLoss: boolean
  threshold: number
  amount: string
}): number {
  const id = nextOrderId++
  const order: IndexedOrder = {
    id,
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
  }
  orderStore.set(order)

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

  const restoredActive = getActiveOrders().length
  const restoredTotal = orderStore.size
  console.log(`[EventIndexer] Started from block ${lastBlock} (restored ${restoredActive} active / ${restoredTotal} total orders)`)

  pollEvents()
  pollInterval = setInterval(pollEvents, intervalMs)
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
      const activeOrders = getActiveOrders()
      for (const order of activeOrders) {
        if (
          order.pair.toLowerCase() === pair.toLowerCase() &&
          order.client.toLowerCase() === client.toLowerCase()
        ) {
          const amountOut = (tokens && tokens.length > 1) ? tokens[1].toString() : ''
          orderStore.update(order.id, {
            status: 'executed' as IndexedOrder['status'],
            executedTxHash: log.transactionHash,
            amountOut,
          })

          pushService.broadcastAll({
            type: 'ORDER_EXECUTED',
            data: {
              orderId: order.orderId,
              amountOut,
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
