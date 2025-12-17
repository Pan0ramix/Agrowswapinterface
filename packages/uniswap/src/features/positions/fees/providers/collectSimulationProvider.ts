/**
 * Collect Simulation Provider
 *
 * Wraps the existing collect() simulation logic as a FeeProvider.
 * This is the authoritative on-chain source for fees.
 */

import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import type {
  FeeProviderParams,
  FeeProviderResult,
  PositionFees,
} from 'uniswap/src/features/positions/fees/feeProviders'
import { formatProviderError, toCurrencyAmountRaw } from 'uniswap/src/features/positions/fees/utils/currencyAmountRaw'
import {
  fallbackSymbol,
  getTokenMetadataCacheKey,
  parseCollectResult,
  readDecimalsRequired,
  safeReadString,
} from 'uniswap/src/features/positions/hooks/useOnChainCollectableFees'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'
import { type PublicClient } from 'viem'

// Local token metadata fetching (shared with onchainMathFeesProvider)
// TODO: Extract to shared utility module
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
      tags: { file: 'collectSimulationProvider', function: 'fetchTokenMetadataLocal' },
      extra: { tokenAddress, chainId },
    })
    return null
  }
}

// Re-export helper types for consistency
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

const COLLECT_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint128', name: 'amount0Max', type: 'uint128' },
          { internalType: 'uint128', name: 'amount1Max', type: 'uint128' },
        ],
        internalType: 'struct INonfungiblePositionManager.CollectParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'collect',
    outputs: [
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const MAX_UINT128 = (1n << 128n) - 1n

/**
 * Collect simulation provider - authoritative on-chain fees via collect() simulation
 */
export async function collectSimulationProvider(params: FeeProviderParams): Promise<FeeProviderResult> {
  const { chainId, tokenId, account, positionManagerAddress } = params

  if (!account) {
    return {
      ok: false,
      reason: 'Account required for collect simulation',
      source: 'collect_simulation',
    }
  }

  try {
    const publicClient = createViemClient({ chainId })
    if (!publicClient) {
      return {
        ok: false,
        reason: `Failed to create public client for chain ${chainId}`,
        source: 'collect_simulation',
      }
    }

    const tokenIdBI = BigInt(String(tokenId))

    // Step 1: Fetch positions(tokenId) to get token0/token1 addresses
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

    // Step 2: Fetch token metadata on-chain
    const [token0Metadata, token1Metadata] = await Promise.all([
      fetchTokenMetadataLocal(publicClient, token0Address, chainId),
      fetchTokenMetadataLocal(publicClient, token1Address, chainId),
    ])

    if (!token0Metadata || !token1Metadata) {
      return {
        ok: false,
        reason: `Failed to fetch token metadata for tokens ${token0Address}/${token1Address}`,
        source: 'collect_simulation',
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

    // Step 3: Simulate collect() call
    const simResult = await publicClient.simulateContract({
      address: positionManagerAddress as `0x${string}`,
      abi: COLLECT_ABI,
      functionName: 'collect',
      args: [
        {
          tokenId: tokenIdBI,
          recipient: account as `0x${string}`,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        },
      ],
      account: account as `0x${string}`,
    })

    // Step 4: Parse result (ensures bigint, never number)
    let amount0Bigint: bigint
    let amount1Bigint: bigint
    try {
      const parsed = parseCollectResult(simResult.result)
      amount0Bigint = parsed.amount0
      amount1Bigint = parsed.amount1
    } catch (parseError) {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('collectSimulationProvider', 'parseCollectResult failed', {
          chainId,
          tokenId: tokenIdBI.toString(),
          token0Address,
          token1Address,
          error: formatProviderError(parseError),
        })
      }
      return {
        ok: false,
        reason: `Failed to parse collect() result: ${formatProviderError(parseError)}`,
        source: 'collect_simulation',
      }
    }

    // Step 5: Convert to string format for CurrencyAmount (JSBI-safe)
    let amount0: CurrencyAmount<Token>
    let amount1: CurrencyAmount<Token>
    try {
      const raw0 = toCurrencyAmountRaw(amount0Bigint) // Converts bigint to string
      const raw1 = toCurrencyAmountRaw(amount1Bigint)
      amount0 = CurrencyAmount.fromRawAmount(token0, raw0)
      amount1 = CurrencyAmount.fromRawAmount(token1, raw1)
    } catch (currencyError) {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('collectSimulationProvider', 'CurrencyAmount creation failed', {
          chainId,
          tokenId: tokenIdBI.toString(),
          token0Address,
          token1Address,
          amount0Type: typeof amount0Bigint,
          amount1Type: typeof amount1Bigint,
          amount0Value: amount0Bigint.toString(),
          amount1Value: amount1Bigint.toString(),
          error: formatProviderError(currencyError),
        })
      }
      return {
        ok: false,
        reason: `Failed to create CurrencyAmount: ${formatProviderError(currencyError)}`,
        source: 'collect_simulation',
      }
    }

    const fees: PositionFees = {
      amount0,
      amount1,
      token0,
      token1,
      source: 'collect_simulation',
      isAuthoritative: true,
      updatedAt: Date.now(),
    }

    return { ok: true, data: fees }
  } catch (error) {
    // NEVER throw from provider - always return { ok: false }
    const errorMessage = formatProviderError(error)

    // Log with context (dev-only for debugging)
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('collectSimulationProvider', 'Provider error', {
        chainId,
        tokenId: String(tokenId),
        account,
        positionManagerAddress,
        error: errorMessage,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      })
    }

    logger.error(error, {
      tags: { file: 'collectSimulationProvider', function: 'collectSimulationProvider' },
      extra: { chainId, tokenId, account, positionManagerAddress },
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
        source: 'collect_simulation',
      }
    }

    return {
      ok: false,
      reason: errorMessage,
      source: 'collect_simulation',
    }
  }
}

