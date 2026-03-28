'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { RightPanel } from '@/components/layout/RightPanel'
import { ChatWindow } from '@/components/chat/ChatWindow'

export default function ChatPage() {
  return (
    <div className="h-screen flex overflow-hidden relative" style={{background: 'hsl(260 87% 3%)'}}>
      {/* Background video + overlay */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <video autoPlay muted playsInline loop className="absolute inset-0 w-full h-full object-cover" style={{opacity: 0.15}}>
          <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260308_114720_3dabeb9e-2c39-4907-b747-bc3544e2d5b7.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(260,87%,3%)] via-[hsl(260,87%,3%)]/70 to-[hsl(260,87%,3%)]" />
      </div>
      <Sidebar />
      <main className="flex-1 overflow-hidden relative z-10">
        <ChatWindow />
      </main>
      <RightPanel />
    </div>
  )
}
