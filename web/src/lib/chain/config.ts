import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

// Contract addresses on Base
export const ADDRESSES = {
  CALLBACK: '0x9702220849b78318d7596B0F6503081DeE0a64f3' as `0x${string}`,
  WETH: '0x4200000000000000000000000000000000000006' as `0x${string}`,
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  UNISWAP_ROUTER: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as `0x${string}`,
  WETH_USDC_PAIR: '0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C' as `0x${string}`,
  CALLBACK_PROXY: '0x0D3E76De6bC44309083cAAFdB49A088B8a250947' as `0x${string}`,
  SESSION_MANAGER: '0x5810d1A3DAEfe21fB266aB00Ec74ca628637550e' as `0x${string}`,
  ORDER_REGISTRY: (process.env.ORDER_REGISTRY || '0x0000000000000000000000000000000000000000') as `0x${string}`,
} as const

// WETH/USDC pair: token0=WETH(18dec), token1=USDC(6dec)
// Price coefficient to normalize decimals: 1e12
export const PRICE_COEFFICIENT = 1000000000000n // 1e12

// ABIs
export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const

export const PAIR_ABI = [
  { type: 'function', name: 'getReserves', inputs: [], outputs: [{ name: 'reserve0', type: 'uint112' }, { name: 'reserve1', type: 'uint112' }, { name: 'blockTimestampLast', type: 'uint32' }], stateMutability: 'view' },
  { type: 'function', name: 'token0', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'token1', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

export const ROUTER_ABI = [
  { type: 'function', name: 'swapExactTokensForTokens', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: 'amounts', type: 'uint256[]' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getAmountsOut', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ name: 'amounts', type: 'uint256[]' }], stateMutability: 'view' },
] as const

export const CALLBACK_ABI = [
  { type: 'function', name: 'stop', inputs: [{ name: '', type: 'address' }, { name: 'pair', type: 'address' }, { name: 'client', type: 'address' }, { name: 'is_token0', type: 'bool' }, { name: 'coefficient', type: 'uint256' }, { name: 'threshold', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
] as const

export const ORDER_REGISTRY_ABI = [
  { type: 'function', name: 'cancelOrder', inputs: [{ name: 'orderId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'orders', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: 'reactiveContract', type: 'address' }, { name: 'pair', type: 'address' }, { name: 'client', type: 'address' }, { name: 'isStopLoss', type: 'bool' }, { name: 'sellToken0', type: 'bool' }, { name: 'coefficient', type: 'uint256' }, { name: 'threshold', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'linkedOrderId', type: 'uint256' }, { name: 'active', type: 'bool' }], stateMutability: 'view' },
] as const

export const SESSION_MANAGER_ABI = [
  { type: 'function', name: 'createSession', inputs: [{ name: 'executor', type: 'address' }, { name: 'maxPerTrade', type: 'uint256' }, { name: 'totalBudget', type: 'uint256' }, { name: 'duration', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeSession', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getSession', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: 'executor', type: 'address' }, { name: 'maxPerTrade', type: 'uint256' }, { name: 'totalBudget', type: 'uint256' }, { name: 'spent', type: 'uint256' }, { name: 'remaining', type: 'uint256' }, { name: 'dailyRemaining', type: 'uint256' }, { name: 'expiry', type: 'uint256' }, { name: 'active', type: 'bool' }, { name: 'expired', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'canExecute', inputs: [{ name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: 'ok', type: 'bool' }, { name: 'reason', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'executeSwap', inputs: [{ name: 'user', type: 'address' }, { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ name: 'amountOut', type: 'uint256' }], stateMutability: 'nonpayable' },
] as const

// Clients
export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
})

export function getWalletClient() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const account = privateKeyToAccount(pk as `0x${string}`)
  return createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  })
}

export function getAccount() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  return privateKeyToAccount(pk as `0x${string}`)
}
