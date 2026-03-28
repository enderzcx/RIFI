import { publicClient, ADDRESSES, ERC20_ABI, getAccount } from './config'
import { formatUnits, formatEther } from 'viem'

export async function getPortfolio(walletAddress?: string) {
  const addr = (walletAddress || getAccount().address) as `0x${string}`

  const [wethBalance, usdcBalance, ethBalance] = await Promise.all([
    publicClient.readContract({
      address: ADDRESSES.WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [addr],
    }),
    publicClient.readContract({
      address: ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [addr],
    }),
    publicClient.getBalance({ address: addr }),
  ])

  return {
    address: addr,
    weth: {
      balance: (wethBalance as bigint).toString(),
      formatted: formatEther(wethBalance as bigint),
    },
    usdc: {
      balance: (usdcBalance as bigint).toString(),
      formatted: formatUnits(usdcBalance as bigint, 6),
    },
    eth: {
      balance: ethBalance.toString(),
      formatted: formatEther(ethBalance),
    },
  }
}
