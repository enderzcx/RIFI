'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

interface ChatHistory {
  id: string
  title: string
  time: string
}

const navItems = [
  {
    href: '/chat',
    label: 'Chat',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  },
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  {
    href: '#',
    label: 'Settings',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [history, setHistory] = useState<ChatHistory[]>([])

  useEffect(() => {
    // Load chat history from localStorage
    try {
      const stored = localStorage.getItem('rifi_chat_history')
      if (stored) setHistory(JSON.parse(stored))
    } catch {}
  }, [])

  return (
    <div className="w-[220px] h-full bg-[#0d1117] flex flex-col border-r border-white/[0.06]">
      {/* Top: Logo + Nav */}
      <div className="p-3 flex flex-col gap-1">
        <Link href="/" className="flex items-center gap-2.5 px-2 py-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white">R</div>
          <span className="text-sm font-semibold">RIFI</span>
        </Link>

        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
                active
                  ? 'bg-zinc-700/40 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto px-3 mt-2">
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">Recent Chats</span>
          <Link href="/chat" className="text-[10px] text-blue-500 hover:text-blue-400">+ New</Link>
        </div>
        {history.length > 0 ? (
          <div className="space-y-0.5">
            {history.map(h => (
              <div
                key={h.id}
                className="px-2 py-1.5 rounded-md text-xs text-zinc-600 truncate"
              >
                {h.title}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-700 px-2">No conversations yet</p>
        )}
      </div>

      {/* Bottom */}
      <div className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-2">
          <div className="w-2 h-2 rounded-full bg-green-400 pulse-dot" />
          <span className="text-[10px] text-zinc-600">Base Mainnet</span>
        </div>
      </div>
    </div>
  )
}
