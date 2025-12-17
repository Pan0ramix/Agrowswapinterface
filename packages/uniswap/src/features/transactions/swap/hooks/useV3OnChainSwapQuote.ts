/**
 * V3 On-Chain Swap Quote Hook
 *
 * Fetches swap quotes and builds transaction payloads using pure on-chain V3 operations.
 * This replaces Trading API quote/swap endpoints for single-pool V3 swaps.
 */

import { skipToken, useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { FeeAmount, Pool } from '@uniswap/v3-sdk'
import { useMemo } from 'react'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import {
  buildExactInputSingleSwapTxStrict,
  fetchV3PoolState,
  getDeadline,
  parseQuoteError,
  quoteExactInputSingle,
  type V3QuoteResult,
} from 'uniswap/src/features/transactions/swap/services/v3OnChain'
import {
  calculateAmountOutMinimumStrict,
  getSlippageToleranceOrError,
} from 'uniswap/src/features/transactions/utils/slippage'
import { logger } from 'utilities/src/logger/logger'

// Using a string directly instead of enum to avoid adding to cache.ts
const V3_ON_CHAIN_SWAP_QUOTE_CACHE_KEY = 'V3OnChainSwapQuote'

/**
 * Hook parameters
 */
interface UseV3OnChainSwapQuoteParams {
  tokenIn: Currency | undefined
  tokenOut: Currency | undefined
  amountIn: CurrencyAmount<Currency> | undefined
  fee: FeeAmount | undefined
  slippageTolerance: Percent
  chainId: EVMUniverseChainId | undefined
  recipient: string | undefined
  enabled?: boolean
}

/**
 * Blocked reason for swap quote
 */
export interface SwapQuoteBlockedReason {
  type: 'INVALID_SLIPPAGE' | 'POOL_NOT_EXISTS' | 'OTHER'
  message: string
  error?: Error | unknown
}

/**
 * Quote result
 */
interface V3SwapQuoteResult {
  // Quote data
  quoteAmountOut?: CurrencyAmount<Currency>
  quoteResult?: V3QuoteResult

  // Pool state
  pool?: Pool
  poolState: 'exists' | 'error'

  // Price impact (simplified calculation)
  priceImpact?: Percent | undefined

  // Transaction payload
  txPayload?: {
    to: string
    data: string
    value: string
  }

  // Minimum amount out with slippage
  amountOutMinimum?: CurrencyAmount<Currency>

  // Validation state
  isValid: boolean
  blockedReason?: SwapQuoteBlockedReason
}

/**
 * Hook return type
 */
interface UseV3OnChainSwapQuoteReturn {
  // Quote data
  quoteAmountOut: CurrencyAmount<Currency> | undefined
  priceImpact: Percent | undefined

  // Transaction payload
  txPayload:
    | {
        to: string
        data: string
        value: string
      }
    | undefined

  // State
  isLoading: boolean
  isError: boolean
  error: Error | null

  // Pool state
  poolState: 'loading' | 'exists' | 'not-exists' | 'error'
  pool: Pool | undefined

  // Raw data
  data: V3SwapQuoteResult | undefined
}

/**
 * React hook for fetching V3 on-chain swap quotes
 *
 * @example
 * ```tsx
 * const { quoteAmountOut, txPayload, isLoading, error } = useV3OnChainSwapQuote({
 *   tokenIn: USDT,
 *   tokenOut: CARBON_TOKEN,
 *   amountIn: CurrencyAmount.fromRawAmount(USDT, '1000000'),
 *   fee: FeeAmount.MEDIUM,
 *   slippageTolerance: new Percent(50, 10000), // 0.5%
 *   chainId: UniverseChainId.BaseSepolia,
 *   recipient: account.address,
 * })
 * ```
 */
export function useV3OnChainSwapQuote(params: UseV3OnChainSwapQuoteParams): UseV3OnChainSwapQuoteReturn {
  const { tokenIn, tokenOut, amountIn, fee, slippageTolerance, chainId, recipient, enabled = true } = params

  // Get viem public client
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Build stable slippage key to prevent "sticky blocked" states
  // Use normalized slippage numerator/denominator for stable cache key
  const slippageKey = useMemo(() => {
    try {
      const normalized = getSlippageToleranceOrError(slippageTolerance)
      if (normalized.ok) {
        const num =
          typeof normalized.value.numerator === 'bigint'
            ? normalized.value.numerator.toString()
            : String(normalized.value.numerator)
        const den =
          typeof normalized.value.denominator === 'bigint'
            ? normalized.value.denominator.toString()
            : String(normalized.value.denominator)
        return `${num}/${den}`
      }
      return slippageTolerance.toFixed()
    } catch {
      return slippageTolerance.toFixed()
    }
  }, [slippageTolerance])

  // Build query key with stable slippage representation
  const queryKey = useMemo(
    () => [
      V3_ON_CHAIN_SWAP_QUOTE_CACHE_KEY,
      chainId,
      tokenIn?.symbol,
      tokenOut?.symbol,
      amountIn?.quotient.toString(),
      fee,
      slippageKey, // Use stable slippage key instead of toFixed()
      recipient,
    ],
    [chainId, tokenIn?.symbol, tokenOut?.symbol, amountIn?.quotient.toString(), fee, slippageKey, recipient],
  )

  // Query function
  const queryFn = useMemo(() => {
    if (!tokenIn || !tokenOut || !amountIn || !fee || !chainId || !recipient || !publicClient) {
      return skipToken
    }

    return async (): Promise<V3SwapQuoteResult> => {
      try {
        // Step 1: Fetch pool state
        const poolState = await fetchV3PoolState({
          tokenIn,
          tokenOut,
          fee,
          chainId,
          publicClient,
        })

        if (!poolState) {
          // Pool does not exist - return blocked result (DO NOT throw)
          return {
            quoteAmountOut: undefined,
            quoteResult: undefined,
            pool: undefined,
            poolState: 'error' as const,
            priceImpact: undefined,
            txPayload: undefined,
            amountOutMinimum: undefined,
            isValid: false,
            blockedReason: {
              type: 'POOL_NOT_EXISTS',
              message: 'Pool does not exist or has no liquidity',
            },
          }
        }

        // Step 2: Get quote from Quoter contract
        const quoteResult = await quoteExactInputSingle({
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          chainId,
          publicClient,
        })

        const quoteAmountOut = CurrencyAmount.fromRawAmount(tokenOut, quoteResult.amountOut)

        // Step 3: Calculate price impact (compare execution price to pool's current price)
        // Execution price = amountOut / amountIn
        // Current price = pool.token0Price or token1Price (depending on direction)
        let priceImpact: Percent | undefined
        try {
          const executionPrice = quoteAmountOut.divide(amountIn)
          const isTokenInToken0 = tokenIn.wrapped.sortsBefore(tokenOut.wrapped)
          const currentPrice = isTokenInToken0 ? poolState.pool.token0Price : poolState.pool.token1Price

          const priceDiff = executionPrice.subtract(currentPrice)
          priceImpact = new Percent(priceDiff.numerator, currentPrice.denominator).multiply('-1')
        } catch (error) {
          // Price impact calculation failed, continue without it
          logger.warn(error, {
            tags: { file: 'useV3OnChainSwapQuote', function: 'priceImpact' },
          })
        }

        // Step 4: Calculate minimum amount out with slippage
        // Use strict mode: fail closed on invalid slippage (prevents building invalid transactions)
        const minOutResult = calculateAmountOutMinimumStrict(quoteAmountOut, slippageTolerance)
        if (!minOutResult.ok) {
          // Invalid slippage - return blocked result (DO NOT throw - prevents UI crash)
          return {
            quoteAmountOut,
            quoteResult,
            pool: poolState.pool,
            poolState: 'error' as const,
            priceImpact,
            txPayload: undefined, // No tx payload when blocked
            amountOutMinimum: undefined,
            isValid: false,
            blockedReason: {
              type: 'INVALID_SLIPPAGE',
              message: 'Invalid slippage setting. Please reset your slippage tolerance to default.',
              error: minOutResult.error,
            },
          }
        }
        const amountOutMinimum = minOutResult.value

        // Step 5: Build transaction payload with strict validation (final security boundary)
        const deadline = getDeadline(20) // 20 minutes from now
        const txPayloadResult = buildExactInputSingleSwapTxStrict({
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          amountOutMinimum,
          expectedAmountOut: quoteAmountOut, // Pass expected output for invariant validation
          recipient,
          deadline,
          chainId,
        })

        if (!txPayloadResult.ok) {
          // Tx build failed (shouldn't happen if hooks validated correctly, but fail-closed)
          // Map error code to blocked reason type
          const errorCode = txPayloadResult.error.code
          let blockedType: 'INVALID_SLIPPAGE' | 'OTHER' = 'OTHER'
          if (errorCode === 'INVALID_SLIPPAGE') {
            blockedType = 'INVALID_SLIPPAGE'
          }

          return {
            quoteAmountOut,
            quoteResult,
            pool: poolState.pool,
            poolState: 'error' as const,
            priceImpact,
            txPayload: undefined,
            amountOutMinimum: undefined,
            isValid: false,
            blockedReason: {
              type: blockedType,
              message: txPayloadResult.error.message || 'Transaction build failed',
              error: txPayloadResult.error,
            },
          }
        }

        const txPayload = txPayloadResult.value

        return {
          quoteAmountOut,
          quoteResult,
          pool: poolState.pool,
          poolState: 'exists' as const,
          priceImpact,
          txPayload,
          amountOutMinimum,
          isValid: true,
          blockedReason: undefined,
        }
      } catch (error) {
        // For unexpected errors, return blocked result instead of throwing
        // This prevents UI crashes while still signaling failure
        const errorMessage = error instanceof Error ? error.message : String(error)
        const parsedError = parseQuoteError(error)

        logger.error(error, {
          tags: {
            file: 'useV3OnChainSwapQuote',
            function: 'useV3OnChainSwapQuote',
          },
          extra: {
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            fee,
            chainId,
            errorMessage: parsedError,
          },
        })

        // Return blocked result instead of throwing (prevents UI crash)
        return {
          quoteAmountOut: undefined,
          quoteResult: undefined,
          pool: undefined,
          poolState: 'error' as const,
          priceImpact: undefined,
          txPayload: undefined,
          amountOutMinimum: undefined,
          isValid: false,
          blockedReason: {
            type: 'OTHER',
            message: parsedError,
            error,
          },
        }
      }
    }
  }, [tokenIn, tokenOut, amountIn, fee, slippageTolerance, chainId, recipient, publicClient])

  // Execute query
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!queryFn && queryFn !== skipToken,
    staleTime: 10_000, // 10 seconds - quotes should be fresh
    gcTime: 30_000, // 30 seconds cache
    retry: 2,
    retryDelay: 1000,
  })

  // Determine pool state
  const poolState = useMemo(() => {
    if (isLoading) {
      return 'loading' as const
    }
    if (isError || error) {
      return 'error' as const
    }
    if (data?.poolState === 'exists') {
      return 'exists' as const
    }
    return 'not-exists' as const
  }, [isLoading, isError, error, data?.poolState])

  return {
    quoteAmountOut: data?.quoteAmountOut,
    priceImpact: data?.priceImpact,
    txPayload: data?.txPayload,
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
    poolState,
    pool: data?.pool,
    data,
  }
}
