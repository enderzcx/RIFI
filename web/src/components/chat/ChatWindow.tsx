'use client'

import { useState, useRef, useEffect, Suspense, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { useSearchParams } from 'next/navigation'
import { Message } from '@/lib/types'
import { ToolCallCard } from './ToolCallCard'

const SUGGESTIONS = [
  'What is the current ETH price?',
  'Analyze the market and suggest a trade',
  'Buy 0.001 ETH with stop loss at $2000',
  'Show my portfolio',
]

function saveSession(id: string, messages: Message[]) {
  try {
    localStorage.setItem(`rifi_chat_${id}`, JSON.stringify(messages))
    const title = messages.find(m => m.role === 'user')?.content.slice(0, 40) || 'Chat'
    const history = JSON.parse(localStorage.getItem('rifi_chat_history') || '[]')
    const idx = history.findIndex((h: { id: string }) => h.id === id)
    const entry = { id, title, time: new Date().toISOString() }
    if (idx >= 0) history[idx] = entry
    else history.unshift(entry)
    localStorage.setItem('rifi_chat_history', JSON.stringify(history.slice(0, 20)))
    window.dispatchEvent(new Event('rifi_history_updated'))
  } catch {}
}

function loadSession(id: string): Message[] {
  try {
    const stored = localStorage.getItem(`rifi_chat_${id}`)
    return stored ? JSON.parse(stored) : []
  } catch { return [] }
}

function ChatInner() {
  const params = useSearchParams()
  const loadId = params.get('session')
  const [sessionId] = useState(() => loadId || crypto.randomUUID())
  const [messages, setMessages] = useState<Message[]>(() => loadId ? loadSession(loadId) : [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const initial = sessionStorage.getItem('rifi_initial_msg')
    if (initial) {
      sessionStorage.removeItem('rifi_initial_msg')
      sendMessage(initial)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload messages when session changes
  useEffect(() => {
    if (loadId) {
      const loaded = loadSession(loadId)
      setMessages(loaded)
    }
  }, [loadId])

  // SSE: auto-trade events → chat messages
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'CONNECTED') return

        let content = ''
        let toolResults: Message['tool_results'] = undefined
        switch (data.type) {
          case 'SIGNAL_ALERT': {
            const trigger = data.data?.trigger || 'High-value signal detected'
            const decision = typeof data.data?.decision === 'string'
              ? data.data.decision
              : JSON.stringify(data.data?.decision, null, 2)
            content = `**[Auto-Trade]** ${trigger}\n\n${decision || ''}`
            // Attach tool calls so user sees what AI actually did
            if (data.data?.decisions?.length) {
              toolResults = data.data.decisions.map((d: { tool: string; args: Record<string, unknown>; result: unknown }) => ({
                tool: d.tool,
                args: d.args || {},
                result: d.result,
              }))
            }
            break
          }
          case 'ORDER_CREATED':
            content = `**[Order Created]** #${data.data?.orderId} ${data.data?.isStopLoss ? 'Stop Loss' : 'Take Profit'} @ $${data.data?.threshold}`
            break
          case 'ORDER_EXECUTED':
            content = `**[Order Executed]** #${data.data?.orderId} filled\n\nTX: \`${data.data?.txHash || 'N/A'}\``
            break
          case 'ORDER_CANCELLED':
            content = `**[Order Cancelled]** #${data.data?.orderId}`
            break
          case 'PATROL_REPORT': {
            const d = data.data || {}
            content = `**[AI Patrol Report]** ${d.period || ''}\n\n${d.report || 'No report'}\n\n> Scans: ${d.scans || 0} | Risk: ${d.risk_range || '?'} | Sentiment: ${d.sentiment_range || '?'} | Trades: ${d.trades_executed || 0} | Dominant: ${d.dominant_action || 'hold'}`
            break
          }
          default:
            return
        }

        const sysMsg: Message = {
          id: crypto.randomUUID(),
          role: 'system',
          content,
          tool_results: toolResults,
          timestamp: Date.now(),
        }
        setMessages(prev => {
          const all = [...prev, sysMsg]
          saveSession(sessionId, all)
          return all
        })
      } catch {}
    }
    return () => es.close()
  }, [sessionId])

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: msg, timestamp: Date.now() }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setLoading(true)

    try {
      const apiMessages = updated.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      })
      const data = await res.json()
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.content,
        tool_results: data.tool_results,
        timestamp: Date.now(),
      }
      setMessages(prev => {
        const all = [...prev, assistantMsg]
        saveSession(sessionId, all)
        return all
      })
    } catch (error) {
      setMessages(prev => {
        const all = [...prev, { id: crypto.randomUUID(), role: 'assistant' as const, content: `Error: ${error}`, timestamp: Date.now() }]
        saveSession(sessionId, all)
        return all
      })
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center pt-[20vh]">
            <h2 className="text-3xl font-semibold gradient-text mb-2">RIFI</h2>
            <p className="text-zinc-500 text-sm mb-8">AI-native trading agent on Base</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => sendMessage(s)}
                  className="text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-full transition-all"
                >{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-4 max-w-3xl mx-auto">
          {messages.map(msg => (
            <div key={msg.id} className={`animate-fade-in-up ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
              {msg.role === 'user' ? (
                <div className="bg-blue-600/20 border border-blue-500/20 rounded-2xl rounded-tr-md px-4 py-3 max-w-[75%]">
                  <p className="text-sm text-blue-100">{msg.content}</p>
                </div>
              ) : msg.role === 'system' ? (
                <div className="max-w-[85%]">
                  <div className="border border-violet-500/20 bg-violet-500/[0.06] rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                      <span className="text-[10px] font-medium text-violet-400 uppercase tracking-wider">Auto-Trade</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    {msg.tool_results && msg.tool_results.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {msg.tool_results.map((tr, i) => <ToolCallCard key={i} tool={tr.tool} args={tr.args} result={tr.result} />)}
                      </div>
                    )}
                    <div className="text-sm text-zinc-200 leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-strong:text-violet-300">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="max-w-[85%]">
                  {msg.tool_results && msg.tool_results.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {msg.tool_results.map((tr, i) => <ToolCallCard key={i} tool={tr.tool} args={tr.args} result={tr.result} />)}
                    </div>
                  )}
                  {msg.content && (
                    <div className="glass-card px-4 py-3">
                      <div className="text-sm text-zinc-200 leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-li:my-0.5 prose-strong:text-white prose-headings:text-zinc-100 prose-code:text-violet-300 prose-code:bg-violet-500/10 prose-code:px-1 prose-code:rounded">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay:'0ms'}}/>
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay:'150ms'}}/>
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay:'300ms'}}/>
              </div>
              RIFI is thinking...
            </div>
          )}
        </div>
      </div>
      <div className="px-6 py-4">
        <div className="max-w-3xl mx-auto relative">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Ask RIFI to trade, analyze markets, set stop-loss..."
            rows={1}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-12 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/30 resize-none"
          />
          <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChatWindow() {
  return <Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>}><ChatInner /></Suspense>
}
