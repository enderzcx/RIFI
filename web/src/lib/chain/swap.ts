import { publicClient, ADDRESSES, ROUTER_ABI, ERC20_ABI, getWalletClient, getAccount } from './config'
import { parseEther, parseUnits, formatEther, formatUnits } from 'viem'

export async function marketSwap(direction: 'buy' | 'sell', amount: string): Promise<{
  txHash: string
  amountIn: string
  amountOut: string
  direction: string
}> {
  const walletClient = getWalletClient()
  const account = getAccount()
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600) // 10 min

  let tokenIn: `0x${string}`
  let tokenOut: `0x${string}`
  let amountIn: bigint

  if (direction === 'buy') {
    // Buy WETH with USDC
    tokenIn = ADDRESSES.USDC
    tokenOut = ADDRESSES.WETH
    amountIn = parseUnits(amount, 6) // USDC has 6 decimals
  } else {
    // Sell WETH for USDC
    tokenIn = ADDRESSES.WETH
    tokenOut = ADDRESSES.USDC
    amountIn = parseEther(amount) // WETH has 18 decimals
  }

  // Check and approve if needed
  const allowance = await publicClient.readContract({
    address: tokenIn,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, ADDRESSES.UNISWAP_ROUTER],
  }) as bigint

  if (allowance < amountIn) {
    const approveTx = await walletClient.writeContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.UNISWAP_ROUTER, amountIn * 10n], // approve 10x for future swaps
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
  }

  // Get expected output
  const amountsOut = await publicClient.readContract({
    address: ADDRESSES.UNISWAP_ROUTER,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountIn, [tokenIn, tokenOut]],
  }) as bigint[]

  const minAmountOut = (amountsOut[1] * 99n) / 100n // 1% slippage

  // Execute swap
  const txHash = await walletClient.writeContract({
    address: ADDRESSES.UNISWAP_ROUTER,
    abi: ROUTER_ABI,
    functionName: 'swapExactTokensForTokens',
    args: [amountIn, minAmountOut, [tokenIn, tokenOut], account.address, deadline],
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  const amountOutFormatted = direction === 'buy'
    ? formatEther(amountsOut[1])
    : formatUnits(amountsOut[1], 6)

  const amountInFormatted = direction === 'buy'
    ? formatUnits(amountIn, 6) + ' USDC'
    : formatEther(amountIn) + ' WETH'

  return {
    txHash,
    amountIn: amountInFormatted,
    amountOut: amountOutFormatted + (direction === 'buy' ? ' WETH' : ' USDC'),
    direction,
  }
}
