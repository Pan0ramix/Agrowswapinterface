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
import { findRoute, buildSwapTx, calculateAmountOutMinimum, getDeadline, getDeadlineSecondsFromNow } from '../services/onchainRouter'
import { validateDecimalsSafetyMultiple } from '../../utils/validateDecimalsSafety'
import { isOnChainRouterEnabled } from '../services/onchainRouter/config'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'
import { isOnChainDebug, makeOnChainDebugId, debugOnChain } from 'uniswap/src/features/transactions/swap/utils/isOnChainDebug'

/**
 * Hook parameters
 */
interface UseOnChainSwapQuoteParams {
  tokenIn: Currency | undefined
  tokenOut: Currency | undefined
  amountIn: CurrencyAmount<Currency> | undefined
  amountOut: CurrencyAmount<Currency> | undefined
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
  quoteAmountIn?: CurrencyAmount<Currency> // For exact output
  quoteAmountOut?: CurrencyAmount<Currency> // For exact input
  route: ReturnType<typeof findRoute> extends Promise<infer T> ? T : never
  priceImpact?: number

  // Transaction payload
  txPayload: {
    to: string
    data: string
    value: string
    gasLimit?: string
  }
  amountInMaximum?: CurrencyAmount<Currency> // For exact output
  amountOutMinimum?: CurrencyAmount<Currency> // For exact input
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
    amountOut,
    slippageTolerance,
    chainId,
    recipient,
    enabled = true,
  } = params
  
  const isExactOut = !!amountOut && !amountIn
  const amount = amountIn || amountOut

  // Get public client
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Build query key
  const queryKey = useMemo(() => {
    if (!tokenIn || !tokenOut || !amount || !chainId || !publicClient) {
      return skipToken
    }

    return [
      ON_CHAIN_SWAP_QUOTE_CACHE_KEY,
      chainId,
      tokenIn.address,
      tokenOut.address,
      isExactOut ? 'exactOut' : 'exactIn',
      amount.quotient.toString(),
      slippageTolerance.toFixed(),
    ]
  }, [tokenIn, tokenOut, amount, isExactOut, chainId, slippageTolerance, publicClient])

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
      !amount ||
      !chainId ||
      !publicClient ||
      !routerEnabled ||
      !recipient
    ) {
      return skipToken
    }

    // Guard: never call on-chain quoting with zero/negative amount
    if (JSBI.lessThanOrEqual(amount.quotient, JSBI.BigInt(0))) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Skip on-chain quote due to zero amount', {
          chainId,
          tokenIn: tokenIn.symbol,
          tokenOut: tokenOut.symbol,
          isExactOut,
          amountRaw: amount.quotient.toString(),
          amountExact: amount.toExact(),
        })
      }
      return skipToken
    }

    return async (): Promise<OnChainSwapQuoteResult> => {
      // Create debug bundle for this quote cycle
      const isDebug = isOnChainDebug(chainId)
      const debugId = isDebug ? makeOnChainDebugId('quote') : undefined
      const debugBundle: Record<string, unknown> = isDebug ? {
        header: {
          debugId,
          chainId,
          mode: 'onchain-only',
          timestamp: Date.now(),
        },
      } : {}
      
      try {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Executing on-chain quote', {
            chainId,
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            isExactOut,
            amountRaw: amount.quotient.toString(),
            amountExact: amount.toExact(),
            recipient,
          })
        }

        // Step 1: Find best route
        const routeResult = await findRoute(
          tokenIn,
          tokenOut,
          amountIn,
          amountOut,
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
            isExactOut,
            amountInRaw: routeResult.amountIn?.quotient?.toString(),
            amountInExact: routeResult.amountIn?.toExact?.(),
            amountOutRaw: routeResult.amountOut?.quotient?.toString(),
            amountOutExact: routeResult.amountOut?.toExact?.(),
            routeDescription: routeResult.route?.description,
            hops: (routeResult.route?.hops ?? []).map((h) => ({
              tokenIn: h.tokenIn.symbol,
              tokenOut: h.tokenOut.symbol,
              fee: h.fee,
            })),
          })
        }

        // Step 2: Calculate slippage-adjusted amounts
        let amountOutMinimum: CurrencyAmount<Currency> | undefined
        let amountInMaximum: CurrencyAmount<Currency> | undefined
        
        if (isExactOut) {
          // For exact output: calculate maximum input with slippage
          // We need to add slippage to amountIn (not subtract) for exact output
          // amountInMaximum = amountIn * (1 + slippage)
          if (!routeResult.amountIn) {
            throw new Error('Route result missing amountIn for exact output')
          }
          // For exact output, we want to allow more input (add slippage tolerance)
          // slippageTolerance is a Percent, e.g., 0.5% = 50/10000
          // We want: amountIn * (1 + slippage) = amountIn * (10000 + slippage.numerator) / 10000
          // Calculate: (amountIn.quotient * (10000 + slippage.numerator)) / 10000
          const slippageNumerator = JSBI.BigInt(slippageTolerance.numerator.toString())
          const slippageDenominator = JSBI.BigInt(slippageTolerance.denominator.toString())
          const multiplier = JSBI.add(slippageDenominator, slippageNumerator) // 1 + slippage
          const maxAmountInRaw = JSBI.divide(
            JSBI.multiply(routeResult.amountIn.quotient, multiplier),
            slippageDenominator
          )
          amountInMaximum = CurrencyAmount.fromRawAmount(
            routeResult.amountIn.currency,
            maxAmountInRaw
          )
        } else {
          // For exact input: calculate minimum output with slippage
          if (!routeResult.amountOut) {
            throw new Error('Route result missing amountOut for exact input')
          }
          amountOutMinimum = calculateAmountOutMinimum(
            routeResult.amountOut,
            slippageTolerance,
          )
        }

        // Step 3: Validate decimals safety (on-chain-only chains)
        // This prevents unsafe transactions with incorrect token decimals
        if (publicClient && routeResult.amountIn && routeResult.amountOut) {
          const decimalsError = await validateDecimalsSafetyMultiple(
            [routeResult.amountIn, routeResult.amountOut],
            publicClient,
          )
          if (decimalsError) {
            throw new Error(decimalsError)
          }
        }

        // Step 4: Build transaction payload
        // CRITICAL: Deadline must be computed fresh at build time (not reused from cache)
        // This ensures deadline is always valid when estimateGas is called
        const deadline = Number(getDeadlineSecondsFromNow(1200)) // 20 minutes TTL, computed fresh
        const nowSeconds = Math.floor(Date.now() / 1000)
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Building tx payload with deadline', {
            chainId,
            nowSeconds,
            deadline,
            deadlineAgeSeconds: deadline - nowSeconds,
            isExactOut,
          })
        }
        if (!routeResult.amountIn || (!isExactOut && !routeResult.amountOut) || (isExactOut && !routeResult.amountOut)) {
          if (chainId === 84532) {
            console.error('[ONCHAIN-QUOTE] Route result missing required amounts', {
              chainId,
              isExactOut,
              hasAmountIn: !!routeResult.amountIn,
              hasAmountOut: !!routeResult.amountOut,
              amountInRaw: routeResult.amountIn?.quotient?.toString(),
              amountOutRaw: routeResult.amountOut?.quotient?.toString(),
            })
          }
          throw new Error('Route result missing required amounts')
        }
        
        const txPayload = buildSwapTx({
          route: routeResult.route,
          amountIn: routeResult.amountIn,
          minAmountOut: amountOutMinimum,
          maxAmountIn: amountInMaximum,
          chainId,
          recipient,
          deadline,
        })

        // Always log for Base Sepolia
        if (chainId === 84532) {
          console.log('[ONCHAIN-QUOTE] Built tx payload', {
            chainId,
            isExactOut,
            to: txPayload.to,
            value: txPayload.value,
            dataLen: txPayload.data?.length,
            gasLimit: txPayload.gasLimit,
            hasMinAmountOut: !!amountOutMinimum,
            hasMaxAmountIn: !!amountInMaximum,
            amountOutMinimumRaw: amountOutMinimum?.quotient?.toString(),
            amountInMaximumRaw: amountInMaximum?.quotient?.toString(),
          })
          logger.debug('useOnChainSwapQuote', 'useOnChainSwapQuote', 'Built on-chain tx payload', {
            chainId,
            to: txPayload.to,
            value: txPayload.value,
            dataLen: txPayload.data?.length,
            gasLimit: txPayload.gasLimit,
            isExactOut,
            amountOutMinimumRaw: amountOutMinimum?.quotient?.toString(),
            amountOutMinimumExact: amountOutMinimum?.toExact?.(),
            amountInMaximumRaw: amountInMaximum?.quotient?.toString(),
            amountInMaximumExact: amountInMaximum?.toExact?.(),
          })
        }

        // Emit debug bundle if enabled (quote-level data)
        if (isDebug) {
          debugBundle.quoteOutputs = {
            amountInRaw: routeResult.amountIn?.quotient?.toString(),
            amountOutRaw: routeResult.amountOut?.quotient?.toString(),
            amountInExact: routeResult.amountIn?.toExact?.(),
            amountOutExact: routeResult.amountOut?.toExact?.(),
            isExactOut,
            quotedRoute: routeResult.route?.description ?? null,
            routerAddress: txPayload.to, // Router address from tx payload
          }
          
          // Emit quote-level bundle (details will be added later in getOnChainSwapDetails)
          debugOnChain(chainId, debugBundle)
        }
        
        return {
          quoteAmountIn: isExactOut ? routeResult.amountIn : undefined,
          quoteAmountOut: isExactOut ? undefined : routeResult.amountOut,
          route: routeResult,
          priceImpact: routeResult.priceImpact,
          txPayload: {
            to: txPayload.to,
            data: txPayload.data,
            value: txPayload.value,
            gasLimit: txPayload.gasLimit,
          },
          amountInMaximum,
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
    amountOut,
    isExactOut,
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
      !!amount &&
      JSBI.greaterThan(amount.quotient, JSBI.BigInt(0)),
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

