'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { RightPanel } from '@/components/layout/RightPanel'
import { ChatWindow } from '@/components/chat/ChatWindow'

export default function ChatPage() {
  return (
    <div className="h-screen flex overflow-hidden relative" style={{background: 'hsl(260 87% 3%)'}}>
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[20%] left-[40%] w-[700px] h-[500px] bg-violet-600/[0.06] rounded-full blur-[150px]" />
        <div className="absolute bottom-[10%] right-[20%] w-[400px] h-[400px] bg-blue-600/[0.04] rounded-full blur-[120px]" />
        {/* Background price chart wave */}
        <svg className="absolute top-[45%] left-0 w-full h-[200px] -translate-y-1/2 opacity-[0.04]" viewBox="0 0 1600 200" preserveAspectRatio="none" fill="none">
          <path d="M0,120 C40,115 80,100 120,95 C160,90 200,110 240,105 C280,100 320,70 360,65 C400,60 440,80 480,90 C520,100 560,85 600,70 C640,55 680,40 720,50 C760,60 800,90 840,100 C880,110 920,95 960,80 C1000,65 1040,50 1080,55 C1120,60 1160,85 1200,95 C1240,105 1280,90 1320,75 C1360,60 1400,70 1440,85 C1480,100 1520,110 1560,105 L1600,100" stroke="rgba(139,92,246,0.8)" strokeWidth="2" />
          <path d="M0,120 C40,115 80,100 120,95 C160,90 200,110 240,105 C280,100 320,70 360,65 C400,60 440,80 480,90 C520,100 560,85 600,70 C640,55 680,40 720,50 C760,60 800,90 840,100 C880,110 920,95 960,80 C1000,65 1040,50 1080,55 C1120,60 1160,85 1200,95 C1240,105 1280,90 1320,75 C1360,60 1400,70 1440,85 C1480,100 1520,110 1560,105 L1600,100 L1600,200 L0,200 Z" fill="url(#bgChartGrad)" />
          <defs>
            <linearGradient id="bgChartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(139,92,246,0.3)" />
              <stop offset="100%" stopColor="rgba(139,92,246,0)" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <Sidebar />
      <main className="flex-1 overflow-hidden relative z-10">
        <ChatWindow />
      </main>
      <RightPanel />
    </div>
  )
}
