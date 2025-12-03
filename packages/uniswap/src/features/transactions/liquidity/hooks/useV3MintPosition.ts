/**
 * V3 Mint Position Hook
 * 
 * Hook for creating new V3 concentrated liquidity positions using on-chain data.
 * Replaces Trading API /v1/lp/create endpoint.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import JSBI from 'jsbi'
import { FeeAmount } from '@uniswap/v3-sdk'
import { skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import {
  buildMintPositionTx,
  calculatePositionAmounts,
  getNearestUsableTicks,
  type LpTransactionPayload,
} from '../services/v3OnChain'
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'
import { getDeadline } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3SwapTxBuilder'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'

/**
 * Hook parameters
 */
interface UseV3MintPositionParams {
  token0: Currency | undefined
  token1: Currency | undefined
  fee: FeeAmount | undefined
  tickLower: number | undefined
  tickUpper: number | undefined
  amount0Desired: CurrencyAmount<Currency> | undefined
  amount1Desired: CurrencyAmount<Currency> | undefined
  slippageTolerance: Percent
  chainId: EVMUniverseChainId | undefined
  recipient: string | undefined
  enabled?: boolean
}

/**
 * Mint position result
 */
interface V3MintPositionResult {
  txPayload: LpTransactionPayload
  positionAmounts: {
    amount0: CurrencyAmount<Currency>
    amount1: CurrencyAmount<Currency>
    liquidity: string
  }
  pool?: any // Pool from V3 SDK - only exists for existing pools, undefined for new pools
  tickLower: number
  tickUpper: number
}

/**
 * Hook return type
 */
interface UseV3MintPositionReturn {
  txPayload: LpTransactionPayload | undefined
  positionAmounts: {
    amount0: CurrencyAmount<Currency> | undefined
    amount1: CurrencyAmount<Currency> | undefined
    liquidity: string | undefined
  }
  isLoading: boolean
  isError: boolean
  error: Error | null
  data: V3MintPositionResult | undefined
}

const V3_MINT_POSITION_CACHE_KEY = 'V3MintPosition'

/**
 * React hook for minting V3 positions using on-chain data
 */
export function useV3MintPosition(params: UseV3MintPositionParams): UseV3MintPositionReturn {
  const {
    token0,
    token1,
    fee,
    tickLower: rawTickLower,
    tickUpper: rawTickUpper,
    amount0Desired,
    amount1Desired,
    slippageTolerance,
    chainId,
    recipient,
    enabled = true,
  } = params

  // Create a stable Percent instance immediately after destructuring
  // This ensures we have a fresh Percent that won't lose its prototype in closures
  const stableSlippage = useMemo(() => {
    if (!(slippageTolerance instanceof Percent)) {
      throw new Error(
        `useV3MintPosition: slippageTolerance must be a Percent at hook entry, got: ${typeof slippageTolerance}`,
      )
    }

    return new Percent(slippageTolerance.numerator, slippageTolerance.denominator)
  }, [slippageTolerance])

  // Extract numerator and denominator for safe closure capture
  const slippageNumerator = stableSlippage.numerator
  const slippageDenominator = stableSlippage.denominator

  // Get viem public client
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Get nearest usable ticks
  const { tickLower, tickUpper } = useMemo(() => {
    if (!fee || rawTickLower === undefined || rawTickUpper === undefined) {
      return { tickLower: undefined, tickUpper: undefined }
    }
    return getNearestUsableTicks(rawTickLower, rawTickUpper, fee)
  }, [fee, rawTickLower, rawTickUpper])

  // Build query key - use slippage numerator/denominator instead of Percent object
  const queryKey = useMemo(
    () => [
      V3_MINT_POSITION_CACHE_KEY,
      chainId,
      token0?.symbol,
      token1?.symbol,
      fee,
      tickLower,
      tickUpper,
      amount0Desired?.quotient.toString(),
      amount1Desired?.quotient.toString(),
      slippageNumerator.toString(),
      slippageDenominator.toString(),
      recipient,
    ],
    [
      chainId,
      token0?.symbol,
      token1?.symbol,
      fee,
      tickLower,
      tickUpper,
      amount0Desired?.quotient.toString(),
      amount1Desired?.quotient.toString(),
      slippageNumerator.toString(),
      slippageDenominator.toString(),
      recipient,
    ],
  )

  // Query function
  const queryFn = useMemo(() => {
    if (
      !token0 ||
      !token1 ||
      !fee ||
      tickLower === undefined ||
      tickUpper === undefined ||
      !chainId ||
      !recipient ||
      !publicClient ||
      (!amount0Desired && !amount1Desired)
    ) {
      return skipToken
    }

    return async (): Promise<V3MintPositionResult> => {
      try {
        // Build stable JSBI numerators/denominators from the captured values
        const slippageNumeratorBI = JSBI.BigInt(slippageNumerator.toString())
        const slippageDenominatorBI = JSBI.BigInt(slippageDenominator.toString())

        // Proper Percent instance for functions that expect a Percent (e.g. mintAmountsWithSlippage)
        const slippage = new Percent(slippageNumeratorBI, slippageDenominatorBI)

        // Step 1: Try to fetch pool state (may not exist for new pools)
        let poolState = await fetchV3PoolState({
          tokenIn: token0,
          tokenOut: token1,
          fee,
          chainId,
          publicClient,
        })

        let positionAmounts: {
          amount0: CurrencyAmount<Currency>
          amount1: CurrencyAmount<Currency>
          liquidity: string
        }
        let pool: any | undefined
        let amount0Min: CurrencyAmount<Currency>
        let amount1Min: CurrencyAmount<Currency>

        if (poolState) {
          // Pool exists - calculate position amounts from pool state
          // Use Uniswap's Position class for accurate calculations
          const positionResult = calculatePositionAmounts(
            poolState.pool,
            tickLower,
            tickUpper,
            amount0Desired,
            amount1Desired,
          )
          positionAmounts = {
            amount0: positionResult.amount0,
            amount1: positionResult.amount1,
            liquidity: positionResult.liquidity,
          }
          pool = poolState.pool

          // Use Position.mintAmountsWithSlippage() - Uniswap's standard pattern
          const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippage)
          amount0Min = min0
          amount1Min = min1
        } else {
          // Pool doesn't exist yet - use desired amounts directly
          // For new pools, apply slippage manually (no use of .complement() prototype)

          if (!amount0Desired || !amount1Desired) {
            throw new Error('Both token amounts are required for new pool creation')
          }
          
          positionAmounts = {
            amount0: amount0Desired,
            amount1: amount1Desired,
            liquidity: '0', // Will be calculated by the contract
          }
          // Pool is undefined for new pools - not needed since contract creates it
          pool = undefined

          // complement = 1 - slippage = (denominator - numerator) / denominator
          const complementNumeratorBI = JSBI.subtract(
            slippageDenominatorBI,
            slippageNumeratorBI,
          )
          const slippageComplement = new Percent(
            complementNumeratorBI,
            slippageDenominatorBI,
          )

          amount0Min = amount0Desired.multiply(slippageComplement)
          amount1Min = amount1Desired.multiply(slippageComplement)
        }

        // Step 3: Build transaction
        // For new pools, pass undefined for pool so buildMintPositionTx knows to skip pool validation
        const txPayload = await buildMintPositionTx({
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          amount0Desired: positionAmounts.amount0,
          amount1Desired: positionAmounts.amount1,
          amount0Min,
          amount1Min,
          recipient,
          deadline: getDeadline(20),
          chainId,
          pool: poolState?.pool, // Only pass pool if it exists
          publicClient,
        })

        return {
          txPayload,
          positionAmounts,
          pool,
          tickLower,
          tickUpper,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        logger.error(error, {
          tags: {
            file: 'useV3MintPosition',
            function: 'useV3MintPosition',
          },
          extra: {
            token0: token0.symbol,
            token1: token1.symbol,
            fee,
            chainId,
            errorMessage,
          },
        })

        throw new Error(errorMessage || 'Failed to build mint position transaction')
      }
    }
  }, [
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    slippageNumerator.toString(), // String, safe for closure - used to recreate Percent in queryFn
    slippageDenominator.toString(), // String, safe for closure - used to recreate Percent in queryFn
    chainId,
    recipient,
    publicClient,
  ])

  // Execute query
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!queryFn && queryFn !== skipToken,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute cache
    retry: 2,
    retryDelay: 1000,
  })

  return {
    txPayload: data?.txPayload,
    positionAmounts: {
      amount0: data?.positionAmounts.amount0,
      amount1: data?.positionAmounts.amount1,
      liquidity: data?.positionAmounts.liquidity,
    },
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
    data,
  }
}

