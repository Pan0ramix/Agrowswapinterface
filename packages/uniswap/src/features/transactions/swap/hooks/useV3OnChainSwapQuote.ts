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
import { logger } from 'utilities/src/logger/logger'
import {
  buildExactInputSingleSwapTx,
  calculateAmountOutMinimum,
  fetchV3PoolState,
  getDeadline,
  parseQuoteError,
  quoteExactInputSingle,
  type V3QuoteResult,
} from 'uniswap/src/features/transactions/swap/services/v3OnChain'

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
 * Quote result
 */
interface V3SwapQuoteResult {
  // Quote data
  quoteAmountOut: CurrencyAmount<Currency>
  quoteResult: V3QuoteResult

  // Pool state
  pool: Pool
  poolState: 'exists'

  // Price impact (simplified calculation)
  priceImpact: Percent | undefined

  // Transaction payload
  txPayload: {
    to: string
    data: string
    value: string
  }

  // Minimum amount out with slippage
  amountOutMinimum: CurrencyAmount<Currency>
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

  // Build query key
  const queryKey = useMemo(
    () => [
      V3_ON_CHAIN_SWAP_QUOTE_CACHE_KEY,
      chainId,
      tokenIn?.symbol,
      tokenOut?.symbol,
      amountIn?.quotient.toString(),
      fee,
      slippageTolerance.toFixed(),
      recipient,
    ],
    [chainId, tokenIn?.symbol, tokenOut?.symbol, amountIn?.quotient.toString(), fee, slippageTolerance, recipient],
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
          throw new Error('Pool does not exist or has no liquidity')
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
        const amountOutMinimum = calculateAmountOutMinimum(quoteAmountOut, slippageTolerance)

        // Step 5: Build transaction payload
        const deadline = getDeadline(20) // 20 minutes from now
        const txPayload = buildExactInputSingleSwapTx({
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          amountOutMinimum,
          recipient,
          deadline,
          chainId,
        })

        return {
          quoteAmountOut,
          quoteResult,
          pool: poolState.pool,
          poolState: 'exists' as const,
          priceImpact,
          txPayload,
          amountOutMinimum,
        }
      } catch (error) {
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

        throw new Error(parsedError)
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
