import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col bg-black">
      {/* Background Video */}
      <video
        autoPlay muted playsInline loop
        className="absolute inset-0 w-full h-full object-cover z-0"
        style={{ opacity: 0.6 }}
      >
        <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/50 z-[1]" />

      {/* Navbar */}
      <nav className="relative z-10 flex justify-between items-center px-8 md:px-[120px] py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 via-violet-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-violet-500/20">R</div>
          <span className="text-xl font-bold tracking-tight">RIFI</span>
        </div>
        <Link
          href="/chat"
          className="relative rounded-full border border-white/80 px-7 py-2.5 bg-black text-sm font-medium text-white hover:bg-white/10 transition-all cursor-pointer"
        >
          Launch App
          <span className="absolute top-0 left-0 w-full h-[6px] bg-gradient-to-t from-white/40 to-transparent blur-md" />
        </Link>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center pt-[120px] pb-[80px]">
        {/* Badge */}
        <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1 text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          <span className="text-white/60">Reactive Network Hackathon</span>
          <span className="text-white">2026</span>
        </div>

        {/* Hero text */}
        <h1
          className="text-5xl md:text-7xl lg:text-[90px] font-medium leading-[1.1] tracking-[-0.02em] mb-6"
          style={{
            background: 'linear-gradient(144.5deg, rgba(255,255,255,1) 28%, rgba(0,0,0,0) 115%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          AI decides.<br />
          Reactive executes.
        </h1>

        {/* Subtitle */}
        <p className="text-white/70 text-[15px] max-w-[520px] leading-relaxed mb-10">
          Autonomous trading agent on Base. 27+ data sources powering real-time decisions. On-chain stop-loss via Reactive Smart Contracts — no backend required.
        </p>

        {/* CTA */}
        <Link
          href="/chat"
          className="relative rounded-full border border-white/80 bg-white px-8 py-3 text-sm font-medium text-black hover:bg-white/90 transition-all cursor-pointer"
        >
          Launch App
          <span className="absolute top-0 left-0 w-full h-[6px] bg-gradient-to-t from-white/40 to-transparent blur-md" />
        </Link>

        <a href="https://github.com/enderzcx/RIFI" target="_blank" rel="noopener noreferrer"
          className="mt-6 text-xs text-white/30 hover:text-white/60 transition-colors">
          View on GitHub
        </a>
      </main>

      {/* Bottom tech strip */}
      <footer className="relative z-10 border-t border-white/[0.06] py-8 px-8">
        <div className="flex justify-center items-center gap-8 md:gap-16 text-xs text-white/25 font-medium tracking-wide">
          <span>BASE</span>
          <span className="w-1 h-1 bg-white/10 rounded-full" />
          <span>REACTIVE NETWORK</span>
          <span className="w-1 h-1 bg-white/10 rounded-full" />
          <span>UNISWAP V2</span>
          <span className="w-1 h-1 bg-white/10 rounded-full" />
          <span>GPT-5.4</span>
        </div>
      </footer>
    </div>
  )
}
