#!/usr/bin/env ts-node
/**
 * Pool Price Audit Script
 * 
 * Audits on-chain pool state to determine ground-truth mid price and fee tier.
 * 
 * Usage:
 *   CHAIN_ID=84532 TX_HASH=0x... pnpm ts-node scripts/auditPoolPrice.ts
 *   POOL_ADDRESS=0x... pnpm ts-node scripts/auditPoolPrice.ts
 */

import { createPublicClient, http, decodeEventLog, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { Token } from '@uniswap/sdk-core'
import { Pool, FeeAmount } from '@uniswap/v3-sdk'
import { JSBI } from '@uniswap/sdk-core'
import { TickMath } from '@uniswap/v3-sdk'

// V3 Factory ABI (for PoolCreated event)
const V3_FACTORY_ABI = [
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
    ],
  },
] as const

// V3 Pool ABI
const V3_POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { internalType: 'int24', name: 'tick', type: 'int24' },
      { internalType: 'uint16', name: 'observationIndex', type: 'uint16' },
      { internalType: 'uint16', name: 'observationCardinality', type: 'uint16' },
      { internalType: 'uint16', name: 'observationCardinalityNext', type: 'uint16' },
      { internalType: 'uint8', name: 'feeProtocol', type: 'uint8' },
      { internalType: 'bool', name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint24', name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ internalType: 'int24', name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ERC20 ABI
const ERC20_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

interface PoolAuditResult {
  poolAddress: string
  token0: { address: string; symbol: string; decimals: number }
  token1: { address: string; symbol: string; decimals: number }
  fee: number
  feePercent: string
  tickSpacing: number
  sqrtPriceX96: string
  tick: number
  liquidity: string
  priceToken1PerToken0: string
  priceToken0PerToken1: string
  priceToken1PerToken0_adjusted: string
  priceToken0PerToken1_adjusted: string
  midPriceMatches1to1: boolean
}

async function getPoolAddressFromTx(
  publicClient: ReturnType<typeof createPublicClient>,
  txHash: string,
): Promise<string | null> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` })
  
  // Look for PoolCreated event
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: V3_FACTORY_ABI,
        data: log.data,
        topics: log.topics,
      })
      
      if (decoded.eventName === 'PoolCreated') {
        return decoded.args.pool as string
      }
    } catch {
      // Not a PoolCreated event, continue
    }
  }
  
  return null
}

async function auditPool(
  publicClient: ReturnType<typeof createPublicClient>,
  poolAddress: string,
): Promise<PoolAuditResult> {
  // Read pool state
  const [slot0, liquidity, token0Addr, token1Addr, fee, tickSpacing] = await Promise.all([
    publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'slot0',
    }),
    publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'liquidity',
    }),
    publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'token0',
    }),
    publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'token1',
    }),
    publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'fee',
    }),
    publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'tickSpacing',
    }),
  ])

  // Read token metadata
  const [token0Symbol, token0Decimals, token1Symbol, token1Decimals] = await Promise.all([
    publicClient.readContract({
      address: token0Addr as Address,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
    publicClient.readContract({
      address: token0Addr as Address,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      address: token1Addr as Address,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
    publicClient.readContract({
      address: token1Addr as Address,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
  ])

  const sqrtPriceX96 = slot0.sqrtPriceX96.toString()
  const tick = Number(slot0.tick)
  const feeValue = Number(fee)
  const feePercent = ((feeValue / 1_000_000) * 100).toFixed(4) + '%'

  // Compute price from sqrtPriceX96
  // price = (sqrtPriceX96 / 2^96)^2
  const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96))
  const sqrtPrice = JSBI.BigInt(sqrtPriceX96)
  const priceX96 = JSBI.multiply(sqrtPrice, sqrtPrice)
  const priceToken1PerToken0_raw = Number(priceX96) / Number(Q96) / Number(Q96)

  // Adjust for decimals
  const decimalsDiff = token1Decimals - token0Decimals
  const decimalsAdjustment = 10 ** decimalsDiff
  const priceToken1PerToken0_adjusted = priceToken1PerToken0_raw * decimalsAdjustment
  const priceToken0PerToken1_adjusted = 1 / priceToken1PerToken0_adjusted

  // Check if mid price is ~1.0 (within 0.1% tolerance)
  const midPriceMatches1to1 = Math.abs(priceToken1PerToken0_adjusted - 1.0) < 0.001

  return {
    poolAddress,
    token0: {
      address: token0Addr,
      symbol: token0Symbol,
      decimals: token0Decimals,
    },
    token1: {
      address: token1Addr,
      symbol: token1Symbol,
      decimals: token1Decimals,
    },
    fee: feeValue,
    feePercent,
    tickSpacing: Number(tickSpacing),
    sqrtPriceX96,
    tick,
    liquidity: liquidity.toString(),
    priceToken1PerToken0: priceToken1PerToken0_raw.toFixed(18),
    priceToken0PerToken1: (1 / priceToken1PerToken0_raw).toFixed(18),
    priceToken1PerToken0_adjusted: priceToken1PerToken0_adjusted.toFixed(18),
    priceToken0PerToken1_adjusted: priceToken0PerToken1_adjusted.toFixed(18),
    midPriceMatches1to1,
  }
}

async function main() {
  const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 84532
  const txHash = process.env.TX_HASH
  const poolAddress = process.env.POOL_ADDRESS

  if (!txHash && !poolAddress) {
    console.error('Error: Either TX_HASH or POOL_ADDRESS must be provided')
    console.error('Usage:')
    console.error('  CHAIN_ID=84532 TX_HASH=0x... pnpm ts-node scripts/auditPoolPrice.ts')
    console.error('  POOL_ADDRESS=0x... pnpm ts-node scripts/auditPoolPrice.ts')
    process.exit(1)
  }

  // Create public client
  const rpcUrl = chainId === 84532 ? 'https://sepolia.base.org' : undefined
  if (!rpcUrl) {
    console.error(`Error: No RPC URL configured for chain ${chainId}`)
    process.exit(1)
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })

  // Get pool address
  let finalPoolAddress: string
  if (poolAddress) {
    finalPoolAddress = poolAddress
  } else if (txHash) {
    console.log(`Fetching pool address from transaction ${txHash}...`)
    const foundAddress = await getPoolAddressFromTx(publicClient, txHash)
    if (!foundAddress) {
      console.error(`Error: Could not find PoolCreated event in transaction ${txHash}`)
      process.exit(1)
    }
    finalPoolAddress = foundAddress
    console.log(`Found pool address: ${finalPoolAddress}`)
  } else {
    throw new Error('Unreachable')
  }

  // Audit pool
  console.log(`\nAuditing pool ${finalPoolAddress}...\n`)
  const result = await auditPool(publicClient, finalPoolAddress)

  // Print report
  console.log('='.repeat(80))
  console.log('POOL AUDIT REPORT')
  console.log('='.repeat(80))
  console.log(`Pool Address: ${result.poolAddress}`)
  console.log(`\nToken Ordering:`)
  console.log(`  token0: ${result.token0.symbol} (${result.token0.address})`)
  console.log(`    Decimals: ${result.token0.decimals}`)
  console.log(`  token1: ${result.token1.symbol} (${result.token1.address})`)
  console.log(`    Decimals: ${result.token1.decimals}`)
  console.log(`\nPool Configuration:`)
  console.log(`  Fee: ${result.fee} (${result.feePercent})`)
  console.log(`  Tick Spacing: ${result.tickSpacing}`)
  console.log(`\nPool State:`)
  console.log(`  sqrtPriceX96: ${result.sqrtPriceX96}`)
  console.log(`  Tick: ${result.tick}`)
  console.log(`  Liquidity: ${result.liquidity}`)
  console.log(`\nPrice Calculations:`)
  console.log(`  Raw price (token1 per token0): ${result.priceToken1PerToken0}`)
  console.log(`  Raw price (token0 per token1): ${result.priceToken0PerToken1}`)
  console.log(`\nDecimals-Adjusted Price:`)
  console.log(`  ${result.token1.symbol} per ${result.token0.symbol}: ${result.priceToken1PerToken0_adjusted}`)
  console.log(`  ${result.token0.symbol} per ${result.token1.symbol}: ${result.priceToken0PerToken1_adjusted}`)
  console.log(`\nAcceptance Check:`)
  console.log(`  Mid price matches 1:1: ${result.midPriceMatches1to1 ? '✅ YES' : '❌ NO'}`)
  console.log(`  Fee tier: ${result.fee} (${result.feePercent})`)
  
  if (result.fee === 10000) {
    console.log(`\n⚠️  NOTE: Fee tier is 10000 (1%).`)
    console.log(`   For a 1:1 pool, swapping 1.00 ${result.token0.symbol} should yield ~0.99 ${result.token1.symbol}`)
    console.log(`   purely due to the 1% fee, NOT price impact.`)
    console.log(`   If UI shows "Price impact: -1.01%", this is likely the fee being mislabeled.`)
  }
  
  console.log('='.repeat(80))
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
