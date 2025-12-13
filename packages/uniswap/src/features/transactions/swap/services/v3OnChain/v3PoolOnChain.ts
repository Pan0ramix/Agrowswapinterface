/**
 * V3 Pool On-Chain State Service
 * 
 * Fetches V3 pool state directly from on-chain contracts without relying on Trading API.
 * Used for single-pool swaps and LP position calculations.
 */

import { Currency, Token } from '@uniswap/sdk-core'
import { FeeAmount, Pool, computePoolAddress } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { PublicClient } from 'viem'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { AGROSWAP_V3_CORE_FACTORY_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'

/**
 * V3 Pool state fetched from on-chain
 */
export interface V3PoolOnChainState {
  pool: Pool
  poolAddress: string
  sqrtPriceX96: string
  tick: number
  liquidity: string
  token0: Token
  token1: Token
  fee: FeeAmount
  observationCardinality?: number
  observationCardinalityNext?: number
  tickSpacing?: number
}

/**
 * Parameters to fetch pool state
 */
export interface FetchV3PoolStateParams {
  tokenIn: Currency
  tokenOut: Currency
  fee: FeeAmount
  chainId: EVMUniverseChainId
  publicClient: PublicClient
}

/**
 * Get the V3 Factory address for the given chain
 */
function getV3FactoryAddress(chainId: EVMUniverseChainId): string {
  const factoryAddresses =
    chainId === 84532 ? AGROSWAP_V3_CORE_FACTORY_ADDRESSES : V3_CORE_FACTORY_ADDRESSES
  const address = factoryAddresses[chainId as keyof typeof factoryAddresses] as string | undefined
  if (!address) {
    throw new Error(`V3 Factory address not found for chain ${chainId}`)
  }
  return address
}

/**
 * V3 Pool ABI for slot0 and liquidity calls
 */
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
]

/**
 * Fetches V3 pool state from on-chain
 * 
 * @param params - Parameters including tokens, fee, chainId, and provider
 * @returns Pool state including Pool instance, address, and raw values
 */
export async function fetchV3PoolState(
  params: FetchV3PoolStateParams,
): Promise<V3PoolOnChainState | null> {
  const { tokenIn, tokenOut, fee, chainId, publicClient } = params

  const tokenA = tokenIn.wrapped
  const tokenB = tokenOut.wrapped

  if (tokenA.equals(tokenB)) {
    return null
  }

  const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA]

  // Compute pool address
  const factoryAddress = getV3FactoryAddress(chainId)
  const poolAddress = computePoolAddress({
    factoryAddress,
    tokenA: token0,
    tokenB: token1,
    fee,
    chainId: chainId as number,
  }) as `0x${string}`

  // Create interface for encoding calls
  const poolInterface = new Interface(V3_POOL_ABI)

  try {
    // Fetch pool state in parallel (including tickSpacing for audit)
    const [slot0Data, liquidityData, tickSpacingData] = await Promise.all([
      publicClient.call({
        to: poolAddress,
        data: poolInterface.encodeFunctionData('slot0') as `0x${string}`,
      }),
      publicClient.call({
        to: poolAddress,
        data: poolInterface.encodeFunctionData('liquidity') as `0x${string}`,
      }),
      publicClient.call({
        to: poolAddress,
        data: poolInterface.encodeFunctionData('tickSpacing') as `0x${string}`,
      }).catch(() => ({ data: null })), // tickSpacing is optional for audit
    ])

    // Decode results
    if (!slot0Data.data || !liquidityData.data) {
      return null
    }

    const slot0 = poolInterface.decodeFunctionResult('slot0', slot0Data.data)
    const liquidity = poolInterface.decodeFunctionResult('liquidity', liquidityData.data)[0]
    const tickSpacing = tickSpacingData.data 
      ? Number(poolInterface.decodeFunctionResult('tickSpacing', tickSpacingData.data)[0])
      : undefined

    const sqrtPriceX96 = slot0.sqrtPriceX96.toString()
    const tick = Number(slot0.tick)

    // Check if pool exists (sqrtPriceX96 > 0 and liquidity > 0)
    if (sqrtPriceX96 === '0' || liquidity.toString() === '0') {
      return null
    }

    // Build Pool instance using V3 SDK
    const pool = new Pool(token0, token1, fee, sqrtPriceX96, liquidity.toString(), tick)

    return {
      pool,
      poolAddress,
      sqrtPriceX96,
      tick,
      liquidity: liquidity.toString(),
      token0,
      token1,
      fee,
      // Additional fields for audit
      observationCardinality: slot0.observationCardinality ? Number(slot0.observationCardinality) : undefined,
      observationCardinalityNext: slot0.observationCardinalityNext ? Number(slot0.observationCardinalityNext) : undefined,
      tickSpacing,
    }
  } catch (error) {
    // Pool doesn't exist or call failed
    return null
  }
}

/**
 * Fetches pool state by pool address directly
 */
export interface FetchV3PoolStateByAddressParams {
  poolAddress: string
  chainId: EVMUniverseChainId
  publicClient: PublicClient
}

export async function fetchV3PoolStateByAddress(
  params: FetchV3PoolStateByAddressParams,
): Promise<{
  sqrtPriceX96: string
  tick: number
  liquidity: string
  token0: string
  token1: string
  fee: number
} | null> {
  const { poolAddress, publicClient } = params

  const poolInterface = new Interface(V3_POOL_ABI)
  const address = poolAddress as `0x${string}`

  try {
    const [slot0Data, liquidityData, token0Data, token1Data, feeData] = await Promise.all([
      publicClient.call({
        to: address,
        data: poolInterface.encodeFunctionData('slot0') as `0x${string}`,
      }),
      publicClient.call({
        to: address,
        data: poolInterface.encodeFunctionData('liquidity') as `0x${string}`,
      }),
      publicClient.call({
        to: address,
        data: poolInterface.encodeFunctionData('token0') as `0x${string}`,
      }),
      publicClient.call({
        to: address,
        data: poolInterface.encodeFunctionData('token1') as `0x${string}`,
      }),
      publicClient.call({
        to: address,
        data: poolInterface.encodeFunctionData('fee') as `0x${string}`,
      }),
    ])

    if (!slot0Data.data || !liquidityData.data) {
      return null
    }

    const slot0 = poolInterface.decodeFunctionResult('slot0', slot0Data.data)
    const liquidity = poolInterface.decodeFunctionResult('liquidity', liquidityData.data)[0]
    const token0 = poolInterface.decodeFunctionResult('token0', token0Data.data || '0x')[0]
    const token1 = poolInterface.decodeFunctionResult('token1', token1Data.data || '0x')[0]
    const fee = poolInterface.decodeFunctionResult('fee', feeData.data || '0x')[0]

    const sqrtPriceX96 = slot0.sqrtPriceX96.toString()

    if (sqrtPriceX96 === '0' || liquidity.toString() === '0') {
      return null
    }

    return {
      sqrtPriceX96,
      tick: Number(slot0.tick),
      liquidity: liquidity.toString(),
      token0,
      token1,
      fee: Number(fee),
    }
  } catch (error) {
    return null
  }
}

