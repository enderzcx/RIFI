'use client'

import { WagmiProvider, createConfig, http, defineChain } from 'wagmi'
import { base } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider, getDefaultConfig } from 'connectkit'

const reactiveNetwork = defineChain({
  id: 1597,
  name: 'Reactive Mainnet',
  nativeCurrency: { name: 'REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet-rpc.rnk.dev/'] } },
})

const config = createConfig(
  getDefaultConfig({
    chains: [base, reactiveNetwork],
    transports: {
      [base.id]: http(),
      [reactiveNetwork.id]: http('https://mainnet-rpc.rnk.dev/'),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '',
    appName: 'RIFI',
    appDescription: 'AI-native trading agent',
  })
)

const queryClient = new QueryClient()

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight">
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
