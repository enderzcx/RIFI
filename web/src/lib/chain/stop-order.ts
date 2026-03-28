import { publicClient, ADDRESSES, ERC20_ABI, PRICE_COEFFICIENT, getWalletClient, getAccount } from './config'
import { createWalletClient, http, parseEther, encodeDeployData, encodeFunctionData } from 'viem'
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

async function deployReactiveContract(threshold: number, clientAddress?: string): Promise<{ reactiveAddress: string; reactiveTxHash: string }> {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')

  const account = privateKeyToAccount(pk as `0x${string}`)
  const reactiveWallet = createWalletClient({
    account,
    chain: REACTIVE_CHAIN,
    transport: http(REACTIVE_RPC),
  })

  const bytecode = getBytecode()
  const client = clientAddress || account.address
  const deployData = encodeDeployData({
    abi: REACTIVE_CONSTRUCTOR_ABI,
    bytecode,
    args: [
      ADDRESSES.WETH_USDC_PAIR,
      ADDRESSES.CALLBACK,
      client as `0x${string}`,
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

export async function setStopLoss(amount: string, threshold: number, clientAddress?: string): Promise<{
  approveTxHash: string
  reactiveTxHash: string
  reactiveAddress: string
  amount: string
  threshold: number
  type: 'stop_loss'
}> {
  const walletClient = getWalletClient()
  const account = getAccount()
  const client = clientAddress || account.address
  const amountWei = parseEther(amount)

  // Step 1: Check client's allowance (user pre-approves during Enable Auto Trading)
  const allowance = await publicClient.readContract({
    address: ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [client as `0x${string}`, ADDRESSES.CALLBACK],
  }) as bigint

  let approveTxHash: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'

  // Only server wallet can self-approve; user must have pre-approved
  if (allowance < amountWei && !clientAddress) {
    approveTxHash = await walletClient.writeContract({
      address: ADDRESSES.WETH,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.CALLBACK, amountWei],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
  }

  // Step 2: Deploy Reactive contract on RNK (client = user's address)
  const { reactiveAddress, reactiveTxHash } = await deployReactiveContract(threshold, clientAddress)

  console.log(`[StopLoss] Deployed reactive at ${reactiveAddress} (threshold=${threshold}, client=${client})`)

  return {
    approveTxHash,
    reactiveTxHash,
    reactiveAddress,
    amount: amount + ' WETH',
    threshold,
    type: 'stop_loss',
  }
}

export async function setTakeProfit(amount: string, threshold: number, clientAddress?: string): Promise<{
  approveTxHash: string
  reactiveTxHash: string
  reactiveAddress: string
  amount: string
  threshold: number
  type: 'take_profit'
}> {
  const walletClient = getWalletClient()
  const account = getAccount()
  const client = clientAddress || account.address
  const amountWei = parseEther(amount)

  // Check client's allowance (user may have pre-approved during Enable Auto Trading)
  const allowance = await publicClient.readContract({
    address: ADDRESSES.WETH,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [client as `0x${string}`, ADDRESSES.CALLBACK],
  }) as bigint

  let approveTxHash: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'

  // Only server wallet can approve here; user should have pre-approved
  if (allowance < amountWei && !clientAddress) {
    approveTxHash = await walletClient.writeContract({
      address: ADDRESSES.WETH,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.CALLBACK, amountWei],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
  }

  const { reactiveAddress, reactiveTxHash } = await deployReactiveContract(threshold, clientAddress)

  console.log(`[TakeProfit] Deployed reactive at ${reactiveAddress} (threshold=${threshold}, client=${clientAddress || account.address})`)

  return {
    approveTxHash,
    reactiveTxHash,
    reactiveAddress,
    amount: amount + ' WETH',
    threshold,
    type: 'take_profit',
  }
}

// Build unsigned txs for user: approve on Base + deploy reactive on RNK
export async function buildStopLossTxs(amount: string, threshold: number, userAddress: string, isStopLoss = true) {
  const addr = userAddress as `0x${string}`
  const amountWei = parseEther(amount)

  const txs: Array<{ to: string; data: string; value: string; chainId: number; description: string }> = []

  // TX 1: Approve WETH to callback on Base (8453)
  const allowance = await publicClient.readContract({
    address: ADDRESSES.WETH, abi: ERC20_ABI, functionName: 'allowance',
    args: [addr, ADDRESSES.CALLBACK],
  }) as bigint

  if (allowance < amountWei) {
    txs.push({
      to: ADDRESSES.WETH,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [ADDRESSES.CALLBACK, amountWei] }),
      value: '0',
      chainId: 8453,
      description: `Approve ${amount} WETH to Stop-Loss Callback`,
    })
  }

  // TX 2: Deploy Reactive contract on RNK (1597)
  const bytecode = getBytecode()
  const deployData = encodeDeployData({
    abi: REACTIVE_CONSTRUCTOR_ABI,
    bytecode,
    args: [
      ADDRESSES.WETH_USDC_PAIR,
      ADDRESSES.CALLBACK,
      addr, // user's address as client
      true,
      PRICE_COEFFICIENT,
      BigInt(threshold),
    ],
  })

  txs.push({
    to: '', // contract creation
    data: deployData,
    value: parseEther('0.1').toString(), // REACT subscription fee
    chainId: 1597,
    description: `Deploy ${isStopLoss ? 'Stop Loss' : 'Take Profit'} @ $${threshold} on Reactive Network`,
  })

  return { txs }
}
