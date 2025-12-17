/**
 * On-Chain Math Fees Provider
 *
 * Computes position fees using Uniswap V3 fee growth formulas with pure on-chain reads.
 * This provides an estimated (non-authoritative) fee calculation as an alternative to
 * collect() simulation.
 */

import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import type {
  FeeProviderParams,
  FeeProviderResult,
  PositionFees,
} from 'uniswap/src/features/positions/fees/feeProviders'
import { formatProviderError, toCurrencyAmountRaw } from 'uniswap/src/features/positions/fees/utils/currencyAmountRaw'
// Import token metadata helpers that are exported
import {
  fallbackSymbol,
  getTokenMetadataCacheKey,
  readDecimalsRequired,
  safeReadString,
} from 'uniswap/src/features/positions/hooks/useOnChainCollectableFees'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'
import { type PublicClient } from 'viem'

// Local token metadata fetching (duplicated for now - could be extracted to shared utility)
const tokenMetadataCache = new Map<string, { decimals: number; symbol: string; name: string }>()

async function fetchTokenMetadataLocal(
  publicClient: PublicClient,
  tokenAddress: string,
  chainId: number,
): Promise<{ symbol: string; decimals: number; name: string } | null> {
  const cacheKey = getTokenMetadataCacheKey(chainId, tokenAddress)
  const cached = tokenMetadataCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const decimals = await readDecimalsRequired(publicClient, tokenAddress)
    const [symbol, name] = await Promise.all([
      safeReadString(publicClient, tokenAddress, 'symbol'),
      safeReadString(publicClient, tokenAddress, 'name'),
    ])

    const metadata = {
      decimals,
      symbol: symbol ?? fallbackSymbol(tokenAddress),
      name: name ?? '',
    }

    tokenMetadataCache.set(cacheKey, metadata)
    return metadata
  } catch (error) {
    logger.error(error, {
      tags: { file: 'onchainMathFeesProvider', function: 'fetchTokenMetadataLocal' },
      extra: { tokenAddress, chainId },
    })
    return null
  }
}

import { AGROSWAP_V3_CORE_FACTORY_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'

// Reuse from collectSimulationProvider
const POSITIONS_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'positions',
    outputs: [
      { internalType: 'uint96', name: 'nonce', type: 'uint96' },
      { internalType: 'address', name: 'operator', type: 'address' },
      { internalType: 'address', name: 'token0', type: 'address' },
      { internalType: 'address', name: 'token1', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'int24', name: 'tickLower', type: 'int24' },
      { internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { internalType: 'uint256', name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { internalType: 'uint128', name: 'tokensOwed0', type: 'uint128' },
      { internalType: 'uint128', name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const V3_FACTORY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

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
    name: 'feeGrowthGlobal0X128',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feeGrowthGlobal1X128',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'int24', name: 'tick', type: 'int24' }],
    name: 'ticks',
    outputs: [
      { internalType: 'uint128', name: 'liquidityGross', type: 'uint128' },
      { internalType: 'int128', name: 'liquidityNet', type: 'int128' },
      { internalType: 'uint256', name: 'feeGrowthOutside0X128', type: 'uint256' },
      { internalType: 'uint256', name: 'feeGrowthOutside1X128', type: 'uint256' },
      { internalType: 'int56', name: 'tickCumulativeOutside', type: 'int56' },
      { internalType: 'uint160', name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
      { internalType: 'uint32', name: 'secondsOutside', type: 'uint32' },
      { internalType: 'bool', name: 'initialized', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const Q128 = 1n << 128n

/**
 * Compute fee growth inside the tick range (Uniswap V3 formula)
 *
 * Rules:
 * - if tickCurrent < tickLower: inside = lowerOutside - upperOutside
 * - else if tickCurrent >= tickUpper: inside = upperOutside - lowerOutside
 * - else: inside = global - lowerOutside - upperOutside
 *
 * Final result is clamped to >= 0n (negative intermediates allowed)
 */
export function computeFeeGrowthInsideX128(params: {
  tickCurrent: number
  tickLower: number
  tickUpper: number
  feeGrowthGlobalX128: bigint
  feeGrowthOutsideLowerX128: bigint
  feeGrowthOutsideUpperX128: bigint
}): bigint {
  const {
    tickCurrent,
    tickLower,
    tickUpper,
    feeGrowthGlobalX128,
    feeGrowthOutsideLowerX128,
    feeGrowthOutsideUpperX128,
  } = params

  let feeGrowthInsideX128: bigint

  if (tickCurrent < tickLower) {
    // Below range: inside = lowerOutside - upperOutside
    feeGrowthInsideX128 = feeGrowthOutsideLowerX128 - feeGrowthOutsideUpperX128
  } else if (tickCurrent >= tickUpper) {
    // Above range: inside = upperOutside - lowerOutside
    feeGrowthInsideX128 = feeGrowthOutsideUpperX128 - feeGrowthOutsideLowerX128
  } else {
    // In range: inside = global - lowerOutside - upperOutside
    feeGrowthInsideX128 = feeGrowthGlobalX128 - feeGrowthOutsideLowerX128 - feeGrowthOutsideUpperX128
  }

  // Clamp to >= 0n (log warning if negative)
  if (feeGrowthInsideX128 < 0n) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(
        {
          tags: { file: 'onchainMathFeesProvider', function: 'computeFeeGrowthInsideX128' },
          extra: {
            tickCurrent,
            tickLower,
            tickUpper,
            feeGrowthGlobalX128: feeGrowthGlobalX128.toString(),
            feeGrowthOutsideLowerX128: feeGrowthOutsideLowerX128.toString(),
            feeGrowthOutsideUpperX128: feeGrowthOutsideUpperX128.toString(),
            computed: feeGrowthInsideX128.toString(),
          },
        },
        'Negative feeGrowthInside computed, clamping to 0',
      )
    }
    return 0n
  }

  return feeGrowthInsideX128
}

/**
 * Compute total fees owed from fee growth delta and tokensOwed
 *
 * Formula:
 * - delta = feeGrowthInsideX128 - feeGrowthInsideLastX128
 * - if delta < 0 → clamp to 0
 * - feesFromGrowth = (liquidity * delta) / Q128
 * - owed = tokensOwed + feesFromGrowth
 */
export function computeFeesOwed(params: {
  liquidity: bigint
  feeGrowthInsideX128: bigint
  feeGrowthInsideLastX128: bigint
  tokensOwed: bigint
}): bigint {
  const { liquidity, feeGrowthInsideX128, feeGrowthInsideLastX128, tokensOwed } = params

  // Compute delta
  let delta = feeGrowthInsideX128 - feeGrowthInsideLastX128

  // Clamp negative delta to 0
  if (delta < 0n) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(
        {
          tags: { file: 'onchainMathFeesProvider', function: 'computeFeesOwed' },
          extra: {
            liquidity: liquidity.toString(),
            feeGrowthInsideX128: feeGrowthInsideX128.toString(),
            feeGrowthInsideLastX128: feeGrowthInsideLastX128.toString(),
            delta: delta.toString(),
          },
        },
        'Negative fee growth delta computed, clamping to 0',
      )
    }
    delta = 0n
  }

  // feesFromGrowth = (liquidity * delta) / Q128
  const feesFromGrowth = (liquidity * delta) / Q128

  // owed = tokensOwed + feesFromGrowth
  return tokensOwed + feesFromGrowth
}

/**
 * Get V3 Factory address for chain (Agroswap contracts)
 *
 * Uses AGROSWAP_V3_CORE_FACTORY_ADDRESSES which includes:
 * - Agroswap factory for Base Sepolia (84532): 0xB1285002ce1173097A7E2A1a0aCa00fBb436370d
 * - SDK addresses for other chains (via spread in agroswapAddresses.ts)
 *
 * This ensures Base Sepolia uses Agroswap's LP contracts, not Uniswap's.
 */
function getFactoryAddress(chainId: number): string | null {
  try {
    // Use AGROSWAP_V3_CORE_FACTORY_ADDRESSES directly (ensures Base Sepolia uses Agroswap factory)
    const factoryAddress =
      AGROSWAP_V3_CORE_FACTORY_ADDRESSES[chainId as keyof typeof AGROSWAP_V3_CORE_FACTORY_ADDRESSES]

    if (factoryAddress) {
      return factoryAddress
    }

    // No factory found for this chain
    return null
  } catch {
    return null
  }
}

/**
 * On-chain math fees provider - estimated fees using Uniswap V3 fee growth formulas
 */
export async function onchainMathFeesProvider(params: FeeProviderParams): Promise<FeeProviderResult> {
  const { chainId, tokenId, positionManagerAddress } = params

  try {
    // Validate tokenId before converting to BigInt
    if (tokenId == null || tokenId === '') {
      return {
        ok: false,
        reason: `Invalid tokenId: ${String(tokenId)}`,
        source: 'onchain_math',
      }
    }

    const publicClient = createViemClient({ chainId })
    if (!publicClient) {
      return {
        ok: false,
        reason: `Failed to create public client for chain ${chainId}`,
        source: 'onchain_math',
      }
    }

    // Safely convert tokenId to BigInt
    let tokenIdBI: bigint
    try {
      tokenIdBI = BigInt(String(tokenId))
    } catch (error) {
      return {
        ok: false,
        reason: `Failed to convert tokenId to BigInt: ${error instanceof Error ? error.message : String(error)}`,
        source: 'onchain_math',
      }
    }

    // Step 1: Fetch positions(tokenId) to get position data
    const positionData = await publicClient.readContract({
      address: positionManagerAddress as `0x${string}`,
      abi: POSITIONS_ABI,
      functionName: 'positions',
      args: [tokenIdBI],
    })

    const positionTuple = positionData as readonly [
      bigint, // nonce
      string, // operator
      string, // token0
      string, // token1
      number, // fee
      number, // tickLower
      number, // tickUpper
      bigint, // liquidity
      bigint, // feeGrowthInside0LastX128
      bigint, // feeGrowthInside1LastX128
      bigint, // tokensOwed0
      bigint, // tokensOwed1
    ]

    const token0Address = positionTuple[2]
    const token1Address = positionTuple[3]
    const fee = positionTuple[4]
    const tickLower = positionTuple[5]
    const tickUpper = positionTuple[6]
    const liquidity = positionTuple[7]
    const feeGrowthInside0LastX128 = positionTuple[8]
    const feeGrowthInside1LastX128 = positionTuple[9]
    const tokensOwed0 = positionTuple[10]
    const tokensOwed1 = positionTuple[11]

    // Step 2: Get pool address from factory
    const factoryAddress = getFactoryAddress(chainId)
    if (!factoryAddress) {
      return {
        ok: false,
        reason: `Factory address not found for chain ${chainId}`,
        source: 'onchain_math',
      }
    }

    // Sort tokens for getPool (lower address first)
    const [tokenA, tokenB] =
      BigInt(token0Address.toLowerCase()) < BigInt(token1Address.toLowerCase())
        ? [token0Address, token1Address]
        : [token1Address, token0Address]

    const poolAddress = (await publicClient.readContract({
      address: factoryAddress as `0x${string}`,
      abi: V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [tokenA as `0x${string}`, tokenB as `0x${string}`, BigInt(fee)],
    })) as `0x${string}`

    if (!poolAddress || poolAddress === '0x0000000000000000000000000000000000000000') {
      return {
        ok: false,
        reason: 'POOL_NOT_FOUND',
        source: 'onchain_math',
      }
    }

    // Step 3: Fetch pool state (slot0, feeGrowthGlobal, ticks)
    const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128, tickLowerData, tickUpperData] = await Promise.all([
      publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'slot0',
      }),
      publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'feeGrowthGlobal0X128',
      }),
      publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'feeGrowthGlobal1X128',
      }),
      publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'ticks',
        args: [BigInt(tickLower)],
      }),
      publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'ticks',
        args: [BigInt(tickUpper)],
      }),
    ])

    const tickCurrent = Number((slot0 as any).tick)

    // Extract feeGrowthOutside from tick data
    const tickLowerResult = tickLowerData as readonly [
      bigint, // liquidityGross
      bigint, // liquidityNet
      bigint, // feeGrowthOutside0X128
      bigint, // feeGrowthOutside1X128
      bigint, // tickCumulativeOutside
      bigint, // secondsPerLiquidityOutsideX128
      number, // secondsOutside
      boolean, // initialized
    ]

    const tickUpperResult = tickUpperData as readonly [
      bigint, // liquidityGross
      bigint, // liquidityNet
      bigint, // feeGrowthOutside0X128
      bigint, // feeGrowthOutside1X128
      bigint, // tickCumulativeOutside
      bigint, // secondsPerLiquidityOutsideX128
      number, // secondsOutside
      boolean, // initialized
    ]

    const feeGrowthOutsideLower0X128 = tickLowerResult[2]
    const feeGrowthOutsideLower1X128 = tickLowerResult[3]
    const feeGrowthOutsideUpper0X128 = tickUpperResult[2]
    const feeGrowthOutsideUpper1X128 = tickUpperResult[3]

    // Step 4: Compute current feeGrowthInside for both tokens
    const feeGrowthInside0X128 = computeFeeGrowthInsideX128({
      tickCurrent,
      tickLower,
      tickUpper,
      feeGrowthGlobalX128: feeGrowthGlobal0X128 as bigint,
      feeGrowthOutsideLowerX128: feeGrowthOutsideLower0X128,
      feeGrowthOutsideUpperX128: feeGrowthOutsideUpper0X128,
    })

    const feeGrowthInside1X128 = computeFeeGrowthInsideX128({
      tickCurrent,
      tickLower,
      tickUpper,
      feeGrowthGlobalX128: feeGrowthGlobal1X128 as bigint,
      feeGrowthOutsideLowerX128: feeGrowthOutsideLower1X128,
      feeGrowthOutsideUpperX128: feeGrowthOutsideUpper1X128,
    })

    // Step 5: Compute fees owed for both tokens
    const amount0Raw = computeFeesOwed({
      liquidity,
      feeGrowthInsideX128: feeGrowthInside0X128,
      feeGrowthInsideLastX128: feeGrowthInside0LastX128,
      tokensOwed: tokensOwed0,
    })

    const amount1Raw = computeFeesOwed({
      liquidity,
      feeGrowthInsideX128: feeGrowthInside1X128,
      feeGrowthInsideLastX128: feeGrowthInside1LastX128,
      tokensOwed: tokensOwed1,
    })

    // Step 6: Fetch token metadata and construct Token instances
    const [token0Metadata, token1Metadata] = await Promise.all([
      fetchTokenMetadataLocal(publicClient, token0Address, chainId),
      fetchTokenMetadataLocal(publicClient, token1Address, chainId),
    ])

    if (!token0Metadata || !token1Metadata) {
      return {
        ok: false,
        reason: `Failed to fetch token metadata for tokens ${token0Address}/${token1Address}`,
        source: 'onchain_math',
      }
    }

    const token0 = new Token(
      chainId,
      token0Address as `0x${string}`,
      token0Metadata.decimals,
      token0Metadata.symbol,
      token0Metadata.name,
    )
    const token1 = new Token(
      chainId,
      token1Address as `0x${string}`,
      token1Metadata.decimals,
      token1Metadata.symbol,
      token1Metadata.name,
    )

    // Step 7: Convert to string format for CurrencyAmount (JSBI-safe)
    let amount0: CurrencyAmount<Token>
    let amount1: CurrencyAmount<Token>
    try {
      const raw0 = toCurrencyAmountRaw(amount0Raw) // Converts bigint to string
      const raw1 = toCurrencyAmountRaw(amount1Raw)
      amount0 = CurrencyAmount.fromRawAmount(token0, raw0)
      amount1 = CurrencyAmount.fromRawAmount(token1, raw1)
    } catch (currencyError) {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('onchainMathFeesProvider', 'CurrencyAmount creation failed', {
          chainId,
          tokenId: tokenIdBI.toString(),
          token0Address,
          token1Address,
          amount0Type: typeof amount0Raw,
          amount1Type: typeof amount1Raw,
          amount0Value: amount0Raw.toString(),
          amount1Value: amount1Raw.toString(),
          error: formatProviderError(currencyError),
        })
      }
      return {
        ok: false,
        reason: `Failed to create CurrencyAmount: ${formatProviderError(currencyError)}`,
        source: 'onchain_math',
      }
    }

    const fees: PositionFees = {
      amount0,
      amount1,
      token0,
      token1,
      source: 'onchain_math',
      isAuthoritative: false,
      updatedAt: Date.now(),
    }

    return { ok: true, data: fees }
  } catch (error) {
    // NEVER throw from provider - always return { ok: false }
    const errorMessage = formatProviderError(error)

    // Log with context (dev-only for debugging)
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('onchainMathFeesProvider', 'Provider error', {
        chainId,
        tokenId: String(tokenId),
        positionManagerAddress,
        error: errorMessage,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      })
    }

    logger.error(error, {
      tags: { file: 'onchainMathFeesProvider', function: 'onchainMathFeesProvider' },
      extra: { chainId, tokenId, positionManagerAddress },
    })

    // Provide more context for BigInt/CurrencyAmount conversion errors
    if (
      errorMessage.includes('Cannot convert') ||
      errorMessage.includes('BigInt') ||
      errorMessage.includes('CurrencyAmount')
    ) {
      return {
        ok: false,
        reason: `CurrencyAmount conversion error: ${errorMessage}`,
        source: 'onchain_math',
      }
    }

    return {
      ok: false,
      reason: errorMessage,
      source: 'onchain_math',
    }
  }
}

