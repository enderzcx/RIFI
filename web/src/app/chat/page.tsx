'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { RightPanel } from '@/components/layout/RightPanel'
import { ChatWindow } from '@/components/chat/ChatWindow'

export default function ChatPage() {
  return (
    <div className="h-screen flex overflow-hidden relative" style={{background: 'hsl(260 87% 3%)'}}>
      {/* Background glow orbs */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[20%] left-[40%] w-[700px] h-[500px] bg-violet-600/[0.06] rounded-full blur-[150px]" />
        <div className="absolute bottom-[10%] right-[20%] w-[400px] h-[400px] bg-blue-600/[0.04] rounded-full blur-[120px]" />
        <div className="absolute top-[60%] left-[10%] w-[300px] h-[300px] bg-indigo-600/[0.03] rounded-full blur-[100px]" />
      </div>
      <Sidebar />
      <main className="flex-1 overflow-hidden relative z-10">
        <ChatWindow />
      </main>
      <RightPanel />
    </div>
  )
}
