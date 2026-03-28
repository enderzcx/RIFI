'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect, Suspense } from 'react'

interface ChatHistory { id: string; title: string; time: string }

const navItems = [
  { href: '/chat', label: 'Chat', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
  { href: '/dashboard', label: 'Dashboard', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
]

function SidebarInner() {
  const pathname = usePathname()
  const params = useSearchParams()
  const activeSession = params.get('session')
  const [history, setHistory] = useState<ChatHistory[]>([])

  function loadHistory() {
    try {
      const stored = localStorage.getItem('rifi_chat_history')
      if (stored) setHistory(JSON.parse(stored))
    } catch {}
  }

  useEffect(() => {
    loadHistory()
    window.addEventListener('rifi_history_updated', loadHistory)
    return () => window.removeEventListener('rifi_history_updated', loadHistory)
  }, [])

  return (
    <div className="w-[200px] h-full bg-[#0a0d12] flex flex-col relative z-10">
      <div className="p-3 flex flex-col gap-1">
        <Link href="/" className="flex items-center gap-2.5 px-2 py-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 via-violet-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-violet-500/20">R</div>
          <div>
            <span className="text-sm font-bold tracking-wide">RIFI</span>
            <span className="block text-[9px] text-zinc-600 -mt-0.5 font-medium tracking-wider">AI TRADING</span>
          </div>
        </Link>
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link key={item.href + item.label} href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${active ? 'bg-zinc-700/40 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'}`}>
              {item.icon}<span>{item.label}</span>
            </Link>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-3 mt-2">
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">Recent Chats</span>
          <button
            onClick={() => {
              const newId = crypto.randomUUID()
              window.location.href = `/chat?session=${newId}`
            }}
            className="text-[10px] text-blue-500 hover:text-blue-400 cursor-pointer"
          >+ New</button>
        </div>
        {history.length > 0 ? (
          <div className="space-y-0.5">
            {history.map(h => (
              <Link key={h.id} href={`/chat?session=${h.id}`}
                className={`block px-2 py-1.5 rounded-md text-xs truncate transition-colors ${
                  activeSession === h.id ? 'bg-zinc-700/40 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30'
                }`}>
                {h.title}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-700 px-2">No conversations yet</p>
        )}
      </div>

      <div className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-2">
          <div className="w-2 h-2 rounded-full bg-green-400 pulse-dot" />
          <span className="text-[10px] text-zinc-600">Base Mainnet</span>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  return <Suspense fallback={<div className="w-[200px]" />}><SidebarInner /></Suspense>
}
