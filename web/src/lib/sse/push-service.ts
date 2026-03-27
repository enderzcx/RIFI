// SSE Push Service — AI主动推送到前端

type SSEClient = {
  id: string
  controller: ReadableStreamDefaultController
}

class PushService {
  private clients: Map<string, Set<SSEClient>> = new Map()

  addClient(wallet: string, client: SSEClient) {
    if (!this.clients.has(wallet)) {
      this.clients.set(wallet, new Set())
    }
    this.clients.get(wallet)!.add(client)
  }

  removeClient(wallet: string, client: SSEClient) {
    this.clients.get(wallet)?.delete(client)
  }

  // Broadcast to all clients of a wallet
  broadcast(wallet: string, event: PushEvent) {
    const clients = this.clients.get(wallet)
    if (!clients) return

    const data = `data: ${JSON.stringify(event)}\n\n`
    const encoder = new TextEncoder()

    for (const client of clients) {
      try {
        client.controller.enqueue(encoder.encode(data))
      } catch {
        clients.delete(client)
      }
    }
  }

  // Broadcast to ALL connected clients
  broadcastAll(event: PushEvent) {
    for (const [wallet] of this.clients) {
      this.broadcast(wallet, event)
    }
  }

  getClientCount(): number {
    let count = 0
    for (const [, clients] of this.clients) {
      count += clients.size
    }
    return count
  }
}

export type PushEventType =
  | 'SIGNAL_ALERT'      // 重要信号预警
  | 'DECISION_MADE'     // AI已执行决策
  | 'ORDER_EXECUTED'    // 链上订单触发
  | 'ORDER_CREATED'     // 新订单创建
  | 'ORDER_CANCELLED'   // 订单取消
  | 'PORTFOLIO_UPDATE'  // 持仓变化

export type SignalLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface PushEvent {
  type: PushEventType
  level?: SignalLevel
  data: Record<string, unknown>
  timestamp: string
}

// Singleton
export const pushService = new PushService()
