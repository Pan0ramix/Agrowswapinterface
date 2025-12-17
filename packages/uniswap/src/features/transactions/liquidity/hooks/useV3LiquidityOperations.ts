/**
 * V3 Liquidity Operations Hooks
 *
 * Hooks for increase, decrease, and collect operations on existing V3 positions.
 * These replace Trading API endpoints: /v1/lp/increase, /v1/lp/decrease, /v1/lp/claim
 */

import { skipToken, useQuery } from '@tanstack/react-query'
import { CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import {
  buildCollectFeesTx,
  buildDecreaseLiquidityTx,
  buildIncreaseLiquidityTx,
  type LpTransactionPayload,
} from 'uniswap/src/features/transactions/liquidity/services/v3OnChain'
import { getDeadline } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3SwapTxBuilder'
import { calculateAmountOutMinimumLenient } from 'uniswap/src/features/transactions/utils/slippage'
import { logger } from 'utilities/src/logger/logger'

/**
 * Increase Liquidity Parameters
 */
interface UseV3IncreaseLiquidityParams {
  tokenId: number | string | undefined
  amount0Desired: CurrencyAmount<any> | undefined
  amount1Desired: CurrencyAmount<any> | undefined
  slippageTolerance: Percent
  chainId: EVMUniverseChainId | undefined
  enabled?: boolean
}

/**
 * Decrease Liquidity Parameters
 */
interface UseV3DecreaseLiquidityParams {
  tokenId: number | string | undefined
  liquidity: string | undefined // Raw liquidity amount from position
  amount0Min: CurrencyAmount<any> | undefined
  amount1Min: CurrencyAmount<any> | undefined
  chainId: EVMUniverseChainId | undefined
  enabled?: boolean
}

/**
 * Collect Fees Parameters
 */
interface UseV3CollectFeesParams {
  tokenId: number | string | undefined
  recipient: string | undefined
  chainId: EVMUniverseChainId | undefined
  enabled?: boolean
}

const V3_INCREASE_LIQUIDITY_CACHE_KEY = 'V3IncreaseLiquidity'
const V3_DECREASE_LIQUIDITY_CACHE_KEY = 'V3DecreaseLiquidity'
const V3_COLLECT_FEES_CACHE_KEY = 'V3CollectFees'

/**
 * Hook for increasing liquidity in an existing position
 */
export function useV3IncreaseLiquidity(params: UseV3IncreaseLiquidityParams): {
  txPayload: LpTransactionPayload | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
} {
  const { tokenId, amount0Desired, amount1Desired, slippageTolerance, chainId, enabled = true } = params

  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  const queryKey = useMemo(
    () => [
      V3_INCREASE_LIQUIDITY_CACHE_KEY,
      chainId,
      tokenId,
      amount0Desired?.quotient.toString(),
      amount1Desired?.quotient.toString(),
      slippageTolerance.toFixed(),
    ],
    [chainId, tokenId, amount0Desired?.quotient.toString(), amount1Desired?.quotient.toString(), slippageTolerance],
  )

  const queryFn = useMemo(() => {
    if (!tokenId || !amount0Desired || !amount1Desired || !chainId || !publicClient) {
      return skipToken
    }

    return async (): Promise<LpTransactionPayload> => {
      try {
        // Use lenient mode: resilient fallback that preserves protection (amountOut if invalid)
        const amount0Min = calculateAmountOutMinimumLenient(amount0Desired, slippageTolerance, {
          feature: 'liquidity',
          chainId,
        })
        const amount1Min = calculateAmountOutMinimumLenient(amount1Desired, slippageTolerance, {
          feature: 'liquidity',
          chainId,
        })

        // Note: buildIncreaseLiquidityTx currently needs liquidity calculation
        // This is a simplified version - in production you'd fetch position details first
        const txPayload = buildIncreaseLiquidityTx({
          tokenId,
          amount0Desired,
          amount1Desired,
          amount0Min,
          amount1Min,
          deadline: getDeadline(20),
          chainId,
        })

        return txPayload
      } catch (error) {
        logger.error(error, {
          tags: { file: 'useV3IncreaseLiquidity', function: 'useV3IncreaseLiquidity' },
        })
        throw error
      }
    }
  }, [tokenId, amount0Desired, amount1Desired, slippageTolerance, chainId, publicClient])

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!queryFn && queryFn !== skipToken,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: 2,
  })

  return {
    txPayload: data,
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
  }
}

/**
 * Hook for decreasing liquidity in an existing position
 */
export function useV3DecreaseLiquidity(params: UseV3DecreaseLiquidityParams): {
  txPayload: LpTransactionPayload | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
} {
  const { tokenId, liquidity, amount0Min, amount1Min, chainId, enabled = true } = params

  const queryKey = useMemo(
    () => [
      V3_DECREASE_LIQUIDITY_CACHE_KEY,
      chainId,
      tokenId,
      liquidity,
      amount0Min?.quotient.toString(),
      amount1Min?.quotient.toString(),
    ],
    [chainId, tokenId, liquidity, amount0Min?.quotient.toString(), amount1Min?.quotient.toString()],
  )

  const queryFn = useMemo(() => {
    if (!tokenId || !liquidity || !amount0Min || !amount1Min || !chainId) {
      return skipToken
    }

    return async (): Promise<LpTransactionPayload> => {
      try {
        const txPayload = buildDecreaseLiquidityTx({
          tokenId,
          liquidity,
          amount0Min,
          amount1Min,
          deadline: getDeadline(20),
          chainId,
        })

        return txPayload
      } catch (error) {
        logger.error(error, {
          tags: { file: 'useV3DecreaseLiquidity', function: 'useV3DecreaseLiquidity' },
        })
        throw error
      }
    }
  }, [tokenId, liquidity, amount0Min, amount1Min, chainId])

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!queryFn && queryFn !== skipToken,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: 2,
  })

  return {
    txPayload: data,
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
  }
}

/**
 * Hook for collecting fees from a position
 */
export function useV3CollectFees(params: UseV3CollectFeesParams): {
  txPayload: LpTransactionPayload | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
} {
  const { tokenId, recipient, chainId, enabled = true } = params

  const queryKey = useMemo(
    () => [V3_COLLECT_FEES_CACHE_KEY, chainId, tokenId, recipient],
    [chainId, tokenId, recipient],
  )

  const queryFn = useMemo(() => {
    if (!tokenId || !recipient || !chainId) {
      return skipToken
    }

    return async (): Promise<LpTransactionPayload> => {
      try {
        const txPayload = buildCollectFeesTx({
          tokenId,
          recipient,
          chainId,
        })

        return txPayload
      } catch (error) {
        logger.error(error, {
          tags: { file: 'useV3CollectFees', function: 'useV3CollectFees' },
        })
        throw error
      }
    }
  }, [tokenId, recipient, chainId])

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!queryFn && queryFn !== skipToken,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: 2,
  })

  return {
    txPayload: data,
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
  }
}
