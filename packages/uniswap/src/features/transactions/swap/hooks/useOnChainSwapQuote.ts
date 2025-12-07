/**
 * On-Chain Swap Quote Hook
 * 
 * Fetches swap quotes using the on-chain router system.
 * Matches the shape of Uniswap's existing hooks so UI remains unchanged.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import JSBI from 'jsbi'
import { skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { findRoute, buildSwapTx, calculateAmountOutMinimum, getDeadline } from '../services/onchainRouter'
import { isOnChainRouterEnabled } from '../services/onchainRouter/config'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'

/**
 * Hook parameters
 */
interface UseOnChainSwapQuoteParams {
  tokenIn: Currency | undefined
  tokenOut: Currency | undefined
  amountIn: CurrencyAmount<Currency> | undefined
  slippageTolerance: Percent
  chainId: EVMUniverseChainId | undefined
  recipient: string | undefined
  enabled?: boolean
}

/**
 * Quote result
 */
interface OnChainSwapQuoteResult {
  // Quote data
  quoteAmountOut: CurrencyAmount<Currency>
  route: ReturnType<typeof findRoute> extends Promise<infer T> ? T : never
  priceImpact?: number

  // Transaction payload
  txPayload: {
    to: string
    data: string
    value: string
    gasLimit?: string
  }
  amountOutMinimum: CurrencyAmount<Currency>
}

/**
 * Hook return type
 */
interface UseOnChainSwapQuoteReturn {
  data: OnChainSwapQuoteResult | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
}

const ON_CHAIN_SWAP_QUOTE_CACHE_KEY = 'OnChainSwapQuote'

/**
 * On-chain swap quote hook
 * 
 * @param params - Quote parameters
 * @returns Quote result with transaction payload
 */
export function useOnChainSwapQuote(
  params: UseOnChainSwapQuoteParams,
): UseOnChainSwapQuoteReturn {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    slippageTolerance,
    chainId,
    recipient,
    enabled = true,
  } = params

  // Get public client
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Build query key
  const queryKey = useMemo(() => {
    if (!tokenIn || !tokenOut || !amountIn || !chainId || !publicClient) {
      return skipToken
    }

    return [
      ON_CHAIN_SWAP_QUOTE_CACHE_KEY,
      chainId,
      tokenIn.address,
      tokenOut.address,
      amountIn.quotient.toString(),
      slippageTolerance.toFixed(),
    ]
  }, [tokenIn, tokenOut, amountIn, chainId, slippageTolerance, publicClient])

  // Check if on-chain router is enabled for this chain
  const routerEnabled = useMemo(() => {
    if (!chainId) {
      return false
    }
    return isOnChainRouterEnabled(chainId)
  }, [chainId])

  // Query function
  const queryFn = useMemo(() => {
    if (
      !tokenIn ||
      !tokenOut ||
      !amountIn ||
      !chainId ||
      !publicClient ||
      !routerEnabled ||
      !recipient
    ) {
      return skipToken
    }

    // Guard: never call on-chain quoting with zero/negative amount
    if (JSBI.lessThanOrEqual(amountIn.quotient, JSBI.BigInt(0))) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Skip on-chain quote due to zero amount', {
          chainId,
          tokenIn: tokenIn.symbol,
          tokenOut: tokenOut.symbol,
          amountInRaw: amountIn.quotient.toString(),
          amountInExact: amountIn.toExact(),
        })
      }
      return skipToken
    }

    return async (): Promise<OnChainSwapQuoteResult> => {
      try {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Executing on-chain quote', {
            chainId,
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            amountInRaw: amountIn.quotient.toString(),
            amountInExact: amountIn.toExact(),
            recipient,
          })
        }

        // Step 1: Find best route
        const routeResult = await findRoute(
          tokenIn,
          tokenOut,
          amountIn,
          chainId,
          publicClient,
        )

        if (!routeResult) {
          throw new Error('No route found for swap')
        }

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Route found', {
            chainId,
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            amountInRaw: amountIn.quotient.toString(),
            amountInExact: amountIn.toExact(),
            amountOutRaw: routeResult.amountOut.quotient.toString(),
            amountOutExact: routeResult.amountOut.toExact(),
            routeDescription: routeResult.route?.description,
            hops: (routeResult.route?.hops ?? []).map((h) => ({
              tokenIn: h.tokenIn.symbol,
              tokenOut: h.tokenOut.symbol,
              fee: h.fee,
            })),
          })
        }

        // Step 2: Calculate minimum amount out with slippage
        const amountOutMinimum = calculateAmountOutMinimum(
          routeResult.amountOut,
          slippageTolerance,
        )

        // Step 3: Build transaction payload
        const deadline = getDeadline(20) // 20 minutes from now
        const txPayload = buildSwapTx({
          route: routeResult.route,
          amountIn,
          minAmountOut: amountOutMinimum,
          chainId,
          recipient,
          deadline,
        })

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Built on-chain tx payload', {
            chainId,
            to: txPayload.to,
            value: txPayload.value,
            dataLen: txPayload.data?.length,
            gasLimit: txPayload.gasLimit,
            amountOutMinimumRaw: amountOutMinimum.quotient.toString(),
            amountOutMinimumExact: amountOutMinimum.toExact(),
          })
        }

        return {
          quoteAmountOut: routeResult.amountOut,
          route: routeResult,
          priceImpact: routeResult.priceImpact,
          txPayload: {
            to: txPayload.to,
            data: txPayload.data,
            value: txPayload.value,
            gasLimit: txPayload.gasLimit,
          },
          amountOutMinimum,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(error, {
          tags: {
            file: 'useOnChainSwapQuote',
            function: 'useOnChainSwapQuote',
          },
          extra: {
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            chainId,
            errorMessage,
          },
        })

        throw new Error(`Failed to get on-chain quote: ${errorMessage}`)
      }
    }
  }, [
    tokenIn,
    tokenOut,
    amountIn,
    slippageTolerance,
    chainId,
    recipient,
    publicClient,
    routerEnabled,
  ])

  // Execute query
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn,
    enabled:
      enabled &&
      routerEnabled &&
      !!queryFn &&
      queryFn !== skipToken &&
      !!amountIn &&
      JSBI.greaterThan(amountIn.quotient, JSBI.BigInt(0)),
    staleTime: 10_000, // 10 seconds - quotes should be fresh
    gcTime: 30_000, // 30 seconds cache
    retry: 2,
    retryDelay: 1000,
  })

  return {
    data,
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
    refetch,
  }
}

