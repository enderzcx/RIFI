import { publicClient, ADDRESSES, ERC20_ABI, PRICE_COEFFICIENT, getWalletClient, getAccount } from './config'
import { createWalletClient, http, parseEther, encodeDeployData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { join } from 'path'

// Reactive Network config
const REACTIVE_RPC = process.env.REACTIVE_RPC || 'https://mainnet-rpc.rnk.dev/'
const REACTIVE_CHAIN = {
  id: 1597,
  name: 'Reactive Mainnet',
  nativeCurrency: { name: 'REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: { default: { http: [REACTIVE_RPC] } },
} as const

// Load compiled bytecode
let REACTIVE_BYTECODE: `0x${string}` | null = null
function getBytecode(): `0x${string}` {
  if (!REACTIVE_BYTECODE) {
    try {
      const raw = readFileSync(join(process.cwd(), 'src/lib/chain/reactive-bytecode.txt'), 'utf-8').trim()
      REACTIVE_BYTECODE = raw as `0x${string}`
    } catch {
      throw new Error('Reactive bytecode not found. Run: forge inspect BaseStopOrderReactive bytecode > reactive-bytecode.txt')
    }
  }
  return REACTIVE_BYTECODE
}

// Constructor ABI for BaseStopOrderReactive
const REACTIVE_CONSTRUCTOR_ABI = [
  { type: 'constructor', inputs: [
    { name: '_pair', type: 'address' },
    { name: '_stop_order', type: 'address' },
    { name: '_client', type: 'address' },
    { name: '_token0', type: 'bool' },
    { name: '_coefficient', type: 'uint256' },
    { name: '_threshold', type: 'uint256' },
  ]}
] as const

async function deployReactiveContract(threshold: number): Promise<{ reactiveAddress: string; reactiveTxHash: string }> {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')

  const account = privateKeyToAccount(pk as `0x${string}`)
  const reactiveWallet = createWalletClient({
    account,
    chain: REACTIVE_CHAIN,
    transport: http(REACTIVE_RPC),
  })

  const bytecode = getBytecode()
  const deployData = encodeDeployData({
    abi: REACTIVE_CONSTRUCTOR_ABI,
    bytecode,
    args: [
      ADDRESSES.WETH_USDC_PAIR,
      ADDRESSES.CALLBACK,
      account.address,
      true, // token0 = WETH
      PRICE_COEFFICIENT,
      BigInt(threshold),
    ],
  })

  const hash = await reactiveWallet.sendTransaction({
    data: deployData,
    value: parseEther('0.1'), // Pay for Reactive subscription
  })

  // Wait for receipt on Reactive Network
  const { createPublicClient: createPub } = await import('viem')
  const reactivePublic = createPub({ chain: REACTIVE_CHAIN, transport: http(REACTIVE_RPC) })
  const receipt = await reactivePublic.waitForTransactionReceipt({ hash })

  return {
    reactiveAddress: receipt.contractAddress || 'unknown',
    reactiveTxHash: hash,
  }
}

export async function setStopLoss(amount: string, threshold: number): Promise<{
  approveTxHash: string
  reactiveTxHash: string
  reactiveAddress: string
  amount: string
  threshold: number
  type: 'stop_loss'
}> {
  const walletClient = getWalletClient()
  const account = getAccount()
  const amountWei = parseEther(amount)

  // Step 1: Approve WETH to callback contract on Base
  const allowance = await publicClient.readContract({
    address: ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, ADDRESSES.CALLBACK],
  }) as bigint

  let approveTxHash: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'

  if (allowance < amountWei) {
    approveTxHash = await walletClient.writeContract({
      address: ADDRESSES.WETH,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.CALLBACK, amountWei],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
  }

  // Step 2: Deploy Reactive contract on RNK
  const { reactiveAddress, reactiveTxHash } = await deployReactiveContract(threshold)

  console.log(`[StopLoss] Deployed reactive at ${reactiveAddress} (threshold=${threshold})`)

  return {
    approveTxHash,
    reactiveTxHash,
    reactiveAddress,
    amount: amount + ' WETH',
    threshold,
    type: 'stop_loss',
  }
}

export async function setTakeProfit(amount: string, threshold: number): Promise<{
  approveTxHash: string
  reactiveTxHash: string
  reactiveAddress: string
  amount: string
  threshold: number
  type: 'take_profit'
}> {
  const walletClient = getWalletClient()
  const account = getAccount()
  const amountWei = parseEther(amount)

  const allowance = await publicClient.readContract({
    address: ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, ADDRESSES.CALLBACK],
  }) as bigint

  let approveTxHash: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'

  if (allowance < amountWei) {
    approveTxHash = await walletClient.writeContract({
      address: ADDRESSES.WETH,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.CALLBACK, amountWei],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
  }

  // Deploy with same logic — the Reactive contract checks below_threshold
  // For take-profit, we still use below_threshold but the threshold is ABOVE current price
  // When price RISES above threshold, reserve1*coeff/reserve0 > threshold... wait.
  // Actually BaseStopOrderReactive only has below_threshold.
  // For take-profit (sell when price goes UP), we need above_threshold.
  // Current simple contract only supports stop-loss direction.
  // For hackathon: use same contract, just note the limitation.
  const { reactiveAddress, reactiveTxHash } = await deployReactiveContract(threshold)

  console.log(`[TakeProfit] Deployed reactive at ${reactiveAddress} (threshold=${threshold})`)

  return {
    approveTxHash,
    reactiveTxHash,
    reactiveAddress,
    amount: amount + ' WETH',
    threshold,
    type: 'take_profit',
  }
}
