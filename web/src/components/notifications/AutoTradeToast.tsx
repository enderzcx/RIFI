'use client'

import { useEffect, useState } from 'react'

interface Notification {
  id: string
  type: string
  level?: string
  title: string
  body: string
  timestamp: string
}

export function AutoTradeToast() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    const es = new EventSource('/api/events')

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'CONNECTED') return

        let title = ''
        let body = ''

        switch (data.type) {
          case 'SIGNAL_ALERT':
            title = '⚡ AI 自动交易决策'
            body = data.data?.trigger || '收到高价值信号'
            if (data.data?.decision) {
              // Extract first line of decision
              const dec = typeof data.data.decision === 'string'
                ? data.data.decision.slice(0, 150)
                : JSON.stringify(data.data.decision).slice(0, 150)
              body += '\n' + dec
            }
            break
          case 'ORDER_CREATED':
            title = '📋 新订单创建'
            body = `订单 #${data.data?.orderId} ${data.data?.isStopLoss ? '止损' : '止盈'} @ $${data.data?.threshold}`
            break
          case 'ORDER_EXECUTED':
            title = '✅ 订单已执行'
            body = `订单 #${data.data?.orderId} 成交\nTX: ${(data.data?.txHash || '').slice(0, 16)}...`
            break
          case 'ORDER_CANCELLED':
            title = '❌ 订单已取消'
            body = `订单 #${data.data?.orderId}`
            break
          default:
            return
        }

        const notif: Notification = {
          id: crypto.randomUUID(),
          type: data.type,
          level: data.level,
          title,
          body,
          timestamp: data.timestamp || new Date().toISOString(),
        }

        setNotifications(prev => [notif, ...prev].slice(0, 5))

        // Auto dismiss after 10s
        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== notif.id))
        }, 10000)
      } catch {}
    }

    return () => es.close()
  }, [])

  if (notifications.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[380px]">
      {notifications.map(n => (
        <div
          key={n.id}
          className={`glass border rounded-xl px-4 py-3 animate-fade-in-up shadow-2xl ${
            n.type === 'SIGNAL_ALERT' ? 'border-violet-500/30 bg-violet-500/5' :
            n.type === 'ORDER_EXECUTED' ? 'border-green-500/30 bg-green-500/5' :
            n.type === 'ORDER_CANCELLED' ? 'border-red-500/30 bg-red-500/5' :
            'border-blue-500/30 bg-blue-500/5'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-100">{n.title}</p>
              <p className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap line-clamp-3">{n.body}</p>
              <p className="text-[10px] text-zinc-600 mt-1.5">
                {new Date(n.timestamp).toLocaleTimeString()}
              </p>
            </div>
            <button
              onClick={() => setNotifications(prev => prev.filter(x => x.id !== n.id))}
              className="text-zinc-600 hover:text-zinc-400 ml-2 text-xs"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
