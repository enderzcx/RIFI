import { publicClient, ADDRESSES, PAIR_ABI, PRICE_COEFFICIENT } from './config'
import { formatUnits } from 'viem'

export async function getPrice(): Promise<{
  price: number
  reserve0: bigint
  reserve1: bigint
  raw_rate: bigint
}> {
  const [reserve0, reserve1] = await publicClient.readContract({
    address: ADDRESSES.WETH_USDC_PAIR,
    abi: PAIR_ABI,
    functionName: 'getReserves',
  }) as [bigint, bigint, number]

  // token0=WETH(18dec), token1=USDC(6dec)
  // rate = reserve1 * 1e12 / reserve0 ≈ price in USD
  const raw_rate = (reserve1 * PRICE_COEFFICIENT) / reserve0
  const price = Number(raw_rate)

  return { price, reserve0, reserve1, raw_rate }
}
