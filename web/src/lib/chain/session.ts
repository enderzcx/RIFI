import { publicClient, ADDRESSES, SESSION_MANAGER_ABI, ERC20_ABI, getWalletClient, getAccount } from './config'
import { parseEther, parseUnits, formatEther, formatUnits } from 'viem'

export interface SessionInfo {
  executor: string
  maxPerTrade: string
  totalBudget: string
  spent: string
  remaining: string
  dailyRemaining: string
  expiry: number
  active: boolean
  expired: boolean
}

export async function getSession(userAddress?: string): Promise<SessionInfo> {
  const user = userAddress || getAccount().address
  const result = await publicClient.readContract({
    address: ADDRESSES.SESSION_MANAGER,
    abi: SESSION_MANAGER_ABI,
    functionName: 'getSession',
    args: [user as `0x${string}`],
  }) as [string, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean]

  return {
    executor: result[0],
    maxPerTrade: formatEther(result[1]),
    totalBudget: formatEther(result[2]),
    spent: formatEther(result[3]),
    remaining: formatEther(result[4]),
    dailyRemaining: formatEther(result[5]),
    expiry: Number(result[6]),
    active: result[7],
    expired: result[8],
  }
}

export async function sessionSwap(
  userAddress: string,
  direction: 'buy' | 'sell',
  amount: string,
): Promise<{ txHash: string; amountIn: string; amountOut: string; direction: string }> {
  const walletClient = getWalletClient()

  let tokenIn: `0x${string}`
  let tokenOut: `0x${string}`
  let amountIn: bigint

  if (direction === 'buy') {
    tokenIn = ADDRESSES.USDC
    tokenOut = ADDRESSES.WETH
    amountIn = parseUnits(amount, 6)
  } else {
    tokenIn = ADDRESSES.WETH
    tokenOut = ADDRESSES.USDC
    amountIn = parseEther(amount)
  }

  const txHash = await walletClient.writeContract({
    address: ADDRESSES.SESSION_MANAGER,
    abi: SESSION_MANAGER_ABI,
    functionName: 'executeSwap',
    args: [userAddress as `0x${string}`, tokenIn, tokenOut, amountIn],
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  const amountInFormatted = direction === 'buy'
    ? amount + ' USDC'
    : amount + ' WETH'

  return {
    txHash,
    amountIn: amountInFormatted,
    amountOut: '(check tx)',
    direction,
  }
}
