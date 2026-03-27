'use client'

import { useState, useRef, useEffect } from 'react'
import { Message } from '@/lib/types'
import { ToolCallCard } from './ToolCallCard'

const SUGGESTIONS = [
  'What is the current ETH price?',
  'Analyze the market and suggest a trade',
  'Buy 0.001 ETH with stop loss at $2000',
  'Show my portfolio',
]

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => crypto.randomUUID())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Auto-send initial message from homepage
  useEffect(() => {
    const initial = sessionStorage.getItem('rifi_initial_msg')
    if (initial) {
      sessionStorage.removeItem('rifi_initial_msg')
      sendMessage(initial)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg || loading) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const apiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }))

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
        const updated = [...prev, assistantMsg]
        // Save to chat history
        try {
          const title = updated.find(m => m.role === 'user')?.content.slice(0, 40) || 'Chat'
          const history = JSON.parse(localStorage.getItem('rifi_chat_history') || '[]')
          const existing = history.findIndex((h: { id: string }) => h.id === sessionId)
          const entry = { id: sessionId, title, time: new Date().toISOString() }
          if (existing >= 0) history[existing] = entry
          else history.unshift(entry)
          localStorage.setItem('rifi_chat_history', JSON.stringify(history.slice(0, 20)))
        } catch {}
        return updated
      })
    } catch (error) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${error}`,
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center pt-[20vh]">
            <h2 className="text-3xl font-semibold gradient-text mb-2">RIFI</h2>
            <p className="text-zinc-500 text-sm mb-8">AI-native trading agent on Base</p>

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-full transition-all"
                >
                  {s}
                </button>
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
              ) : (
                <div className="max-w-[85%]">
                  {/* Tool results */}
                  {msg.tool_results && msg.tool_results.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {msg.tool_results.map((tr, i) => (
                        <ToolCallCard key={i} {...tr} />
                      ))}
                    </div>
                  )}
                  <div className="glass-card px-4 py-3 rounded-2xl rounded-tl-md">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="animate-fade-in-up">
              <div className="glass-card px-4 py-3 rounded-2xl rounded-tl-md inline-block">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-zinc-500">Analyzing...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="px-6 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="glass rounded-2xl p-1 flex items-end gap-2 glow-border">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask RIFI to trade, analyze markets, set stop-loss..."
              rows={1}
              className="flex-1 bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all mr-1 mb-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
