/**
 * V3 Mint Position Hook
 * 
 * Hook for creating new V3 concentrated liquidity positions using on-chain data.
 * Replaces Trading API /v1/lp/create endpoint.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import JSBI from 'jsbi'
import { FeeAmount, Pool } from '@uniswap/v3-sdk'
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
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { simulateTransaction } from '../utils/decodeRevertReason'
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
  // Indicates UI is in "create pool" mode (no on-chain pool yet)
  creatingPoolOrPair?: boolean
  // Optional mock pool carrying initial price (sqrtPriceX96) for creation
  pool?: Pool
  // Optional: account address for transaction simulation (if not provided, simulation is skipped)
  accountAddress?: string
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
  const { accountAddress, ...restParams } = params
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
    creatingPoolOrPair = false,
    pool: poolForPosition,
  } = restParams

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

  // Memoize stringified slippage values to prevent query recreation
  const { slippageNumeratorStr, slippageDenominatorStr } = useMemo(
    () => ({
      slippageNumeratorStr: slippageNumerator.toString(),
      slippageDenominatorStr: slippageDenominator.toString(),
    }),
    [slippageNumerator, slippageDenominator],
  )

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
      slippageNumeratorStr,
      slippageDenominatorStr,
      recipient,
      creatingPoolOrPair,
      poolForPosition?.sqrtRatioX96?.toString(),
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
      slippageNumeratorStr,
      slippageDenominatorStr,
      recipient,
      creatingPoolOrPair,
      poolForPosition?.sqrtRatioX96,
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
        const slippageNumeratorBI = JSBI.BigInt(slippageNumeratorStr)
        const slippageDenominatorBI = JSBI.BigInt(slippageDenominatorStr)

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

        // Compute pool address for diagnostics (even if pool doesn't exist)
        const factoryAddress = chainId === 84532 
          ? (await import('uniswap/src/constants/agroswapAddresses')).AGROSWAP_V3_CORE_FACTORY_ADDRESSES[chainId]
          : (await import('@uniswap/sdk-core')).V3_CORE_FACTORY_ADDRESSES[chainId as keyof typeof import('@uniswap/sdk-core').V3_CORE_FACTORY_ADDRESSES]
        const { computePoolAddress } = await import('@uniswap/v3-sdk')
        const tokenA = token0.wrapped
        const tokenB = token1.wrapped
        const [sortedToken0, sortedToken1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA]
        const poolAddress = computePoolAddress({
          factoryAddress,
          tokenA: sortedToken0,
          tokenB: sortedToken1,
          fee,
          chainId: chainId as number,
        }) as `0x${string}`

        // Check if pool code exists and get slot0 for diagnostics
        let poolCodeExists = false
        let slot0: { sqrtPriceX96: bigint; tick: number } | null = null
        try {
          const poolCode = await publicClient.getBytecode({ address: poolAddress })
          poolCodeExists = !!poolCode && poolCode !== '0x'
          
          if (poolCodeExists) {
            // Try to read slot0 to check if pool is initialized
            const poolInterface = new (await import('ethers/lib/utils')).Interface([
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
            ])
            const slot0Data = await publicClient.call({
              to: poolAddress,
              data: poolInterface.encodeFunctionData('slot0') as `0x${string}`,
            })
            if (slot0Data.data) {
              const decoded = poolInterface.decodeFunctionResult('slot0', slot0Data.data)
              slot0 = {
                sqrtPriceX96: decoded.sqrtPriceX96,
                tick: Number(decoded.tick),
              }
            }
          }
        } catch (error) {
          // Pool doesn't exist or call failed
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[useV3MintPosition] Failed to check pool code/slot0:', error)
          }
        }

        // Extract initial price from mock pool (used for create path)
        const initialPriceFromPool = poolForPosition?.sqrtRatioX96?.toString()

        // Decide whether we should create the pool on-chain (create + initialize + mint)
        const poolInitialized = slot0 ? slot0.sqrtPriceX96 > 0n : !!poolState?.pool
        const sqrtPriceForCreationCandidate =
          initialPriceFromPool ??
          (slot0 ? slot0.sqrtPriceX96.toString() : undefined) ??
          poolState?.pool?.sqrtRatioX96?.toString()

        const shouldCreatePoolOnChain =
          isOnChainRouterEnabled(chainId) &&
          !poolInitialized &&
          !!sqrtPriceForCreationCandidate &&
          (creatingPoolOrPair || !poolCodeExists)

        const sqrtPriceForCreation = shouldCreatePoolOnChain ? sqrtPriceForCreationCandidate : undefined

        // Dev-only: log pool diagnostics
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] pool diagnostics', {
            chainId,
            token0: token0.address,
            token1: token1.address,
            fee,
            poolAddress,
            poolCodeExists,
            slot0: slot0
              ? {
              sqrtPriceX96: slot0.sqrtPriceX96.toString(),
              tick: slot0.tick,
                }
              : null,
            poolInitialized,
            poolStateExists: !!poolState,
            creatingPoolOrPair,
            shouldCreatePoolOnChain,
            createPoolFallback: !creatingPoolOrPair && !poolCodeExists,
            sqrtPriceForCreation,
            hasMockPool: !!poolForPosition,
          })
        }

        // Dev-only: log input amounts BEFORE processing
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] Input amounts (before processing)', {
            token0: {
              address: token0.address,
              symbol: token0.symbol,
              decimals: token0.decimals,
            },
            token1: {
              address: token1.address,
              symbol: token1.symbol,
              decimals: token1.decimals,
            },
            amount0Desired: amount0Desired ? {
              raw: amount0Desired.quotient.toString(),
              human: amount0Desired.toExact(),
              currency: amount0Desired.currency.symbol,
              decimals: amount0Desired.currency.decimals,
            } : undefined,
            amount1Desired: amount1Desired ? {
              raw: amount1Desired.quotient.toString(),
              human: amount1Desired.toExact(),
              currency: amount1Desired.currency.symbol,
              decimals: amount1Desired.currency.decimals,
            } : undefined,
            slippageTolerance: {
              numerator: slippage.numerator.toString(),
              denominator: slippage.denominator.toString(),
              percent: slippage.toFixed(2),
            },
          })
        }

        // Early detection: Pool does not exist or is not initialized
        // Throw structured error before attempting to build mint transaction
        if (!poolCodeExists && !shouldCreatePoolOnChain) {
          const poolNotFoundError = new Error(
            'The V3 pool for this token pair and fee tier does not exist on this chain. A pool must be created and initialized before you can add liquidity.',
          ) as Error & {
            code: 'POOL_NOT_FOUND'
            userMessage: string
            chainId: number
            token0: string
            token1: string
            fee: number
            poolAddress: string
          }
          
          poolNotFoundError.code = 'POOL_NOT_FOUND'
          poolNotFoundError.userMessage = poolNotFoundError.message
          poolNotFoundError.chainId = chainId
          poolNotFoundError.token0 = token0.address
          poolNotFoundError.token1 = token1.address
          poolNotFoundError.fee = fee
          poolNotFoundError.poolAddress = poolAddress

          if (process.env.NODE_ENV !== 'production') {
            console.debug('[useV3MintPosition] Pool not found, throwing structured error', {
              chainId,
              token0: token0.address,
              token1: token1.address,
              fee,
              poolAddress,
            })
          }

          throw poolNotFoundError
        }

        // Check if pool exists but is not initialized
        if (poolCodeExists && slot0 && slot0.sqrtPriceX96 === 0n && !shouldCreatePoolOnChain) {
          const poolNotInitializedError = new Error(
            'The V3 pool for this token pair and fee tier exists but is not initialized. Pool initialization is required before you can add liquidity.',
          ) as Error & {
            code: 'POOL_NOT_INITIALIZED'
            userMessage: string
            chainId: number
            token0: string
            token1: string
            fee: number
            poolAddress: string
          }
          
          poolNotInitializedError.code = 'POOL_NOT_INITIALIZED'
          poolNotInitializedError.userMessage = poolNotInitializedError.message
          poolNotInitializedError.chainId = chainId
          poolNotInitializedError.token0 = token0.address
          poolNotInitializedError.token1 = token1.address
          poolNotInitializedError.fee = fee
          poolNotInitializedError.poolAddress = poolAddress

          if (process.env.NODE_ENV !== 'production') {
            console.debug('[useV3MintPosition] Pool not initialized, throwing structured error', {
              chainId,
              token0: token0.address,
              token1: token1.address,
              fee,
              poolAddress,
            })
          }

          throw poolNotInitializedError
        }

        let positionAmounts: {
          amount0: CurrencyAmount<Currency>
          amount1: CurrencyAmount<Currency>
          liquidity: string
        }
        let pool: any | undefined
        let amount0Min: CurrencyAmount<Currency>
        let amount1Min: CurrencyAmount<Currency>
        let sqrtPriceX96ForCall: string | undefined

        if (poolState) {
          // Pool exists - calculate position amounts from pool state
          // Use Uniswap's Position class for accurate calculations
          
          // Dev-only: log before calculatePositionAmounts
          if (process.env.NODE_ENV !== 'production') {
            console.log('[useV3MintPosition] Pool exists - calculating position amounts', {
              pool: {
                token0: poolState.pool.token0.address,
                token1: poolState.pool.token1.address,
                fee: poolState.pool.fee,
                sqrtPriceX96: poolState.pool.sqrtRatioX96?.toString(),
                tickCurrent: poolState.pool.tickCurrent,
              },
              tickLower,
              tickUpper,
              amount0Desired: amount0Desired ? {
                raw: amount0Desired.quotient.toString(),
                human: amount0Desired.toExact(),
                currency: amount0Desired.currency.symbol,
              } : undefined,
              amount1Desired: amount1Desired ? {
                raw: amount1Desired.quotient.toString(),
                human: amount1Desired.toExact(),
                currency: amount1Desired.currency.symbol,
              } : undefined,
            })
          }
          
          const positionResult = calculatePositionAmounts(
            poolState.pool,
            tickLower,
            tickUpper,
            amount0Desired,
            amount1Desired,
          )
          
          // Dev-only: log after calculatePositionAmounts
          if (process.env.NODE_ENV !== 'production') {
            console.log('[useV3MintPosition] Position amounts calculated (pool exists)', {
              positionAmounts: {
                amount0: {
                  raw: positionResult.amount0.quotient.toString(),
                  human: positionResult.amount0.toExact(),
                  currency: positionResult.amount0.currency.symbol,
                },
                amount1: {
                  raw: positionResult.amount1.quotient.toString(),
                  human: positionResult.amount1.toExact(),
                  currency: positionResult.amount1.currency.symbol,
                },
                liquidity: positionResult.liquidity,
              },
              inputVsOutput: {
                amount0DesiredVsCalculated: amount0Desired ? {
                  input: amount0Desired.quotient.toString(),
                  calculated: positionResult.amount0.quotient.toString(),
                  match: amount0Desired.quotient.toString() === positionResult.amount0.quotient.toString(),
                } : undefined,
                amount1DesiredVsCalculated: amount1Desired ? {
                  input: amount1Desired.quotient.toString(),
                  calculated: positionResult.amount1.quotient.toString(),
                  match: amount1Desired.quotient.toString() === positionResult.amount1.quotient.toString(),
                } : undefined,
              },
            })
          }
          
          positionAmounts = {
            amount0: positionResult.amount0,
            amount1: positionResult.amount1,
            liquidity: positionResult.liquidity,
          }
          pool = poolState.pool
          sqrtPriceX96ForCall = poolState.pool?.sqrtRatioX96?.toString() ?? sqrtPriceForCreation

          // Use Position.mintAmountsWithSlippage() - Uniswap's standard pattern
          const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippage)
          
          // Dev-only: log slippage application
          if (process.env.NODE_ENV !== 'production') {
            console.log('[useV3MintPosition] Slippage applied (pool exists)', {
              slippage: {
                numerator: slippage.numerator.toString(),
                denominator: slippage.denominator.toString(),
                percent: slippage.toFixed(2),
              },
              amount0Min: {
                raw: min0.quotient.toString(),
                human: min0.toExact(),
                currency: min0.currency.symbol,
              },
              amount1Min: {
                raw: min1.quotient.toString(),
                human: min1.toExact(),
                currency: min1.currency.symbol,
              },
              validation: {
                amount0MinLessThanDesired: min0.quotient <= positionResult.amount0.quotient,
                amount1MinLessThanDesired: min1.quotient <= positionResult.amount1.quotient,
              },
            })
          }
          
          amount0Min = min0
          amount1Min = min1
        } else {
          // Pool doesn't exist yet - use desired amounts directly
          // For new pools, apply slippage manually (no use of .complement() prototype)

          if (!amount0Desired || !amount1Desired) {
            throw new Error('Both token amounts are required for new pool creation')
          }
          sqrtPriceX96ForCall = sqrtPriceForCreation
          
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

          // Dev-only: log amounts for new pool (after slippage)
          if (process.env.NODE_ENV !== 'production') {
            console.log('[useV3MintPosition] New pool amounts (after slippage)', {
              amount0Desired: {
                raw: amount0Desired.quotient.toString(),
                human: amount0Desired.toExact(),
                currency: amount0Desired.currency.symbol,
              },
              amount1Desired: {
                raw: amount1Desired.quotient.toString(),
                human: amount1Desired.toExact(),
                currency: amount1Desired.currency.symbol,
              },
              amount0Min: {
                raw: amount0Min.quotient.toString(),
                human: amount0Min.toExact(),
                currency: amount0Min.currency.symbol,
              },
              amount1Min: {
                raw: amount1Min.quotient.toString(),
                human: amount1Min.toExact(),
                currency: amount1Min.currency.symbol,
              },
              slippageComplement: {
                numerator: slippageComplement.numerator.toString(),
                denominator: slippageComplement.denominator.toString(),
                percent: slippageComplement.toFixed(4),
              },
              validation: {
                amount0MinLessThanDesired: amount0Min.quotient <= amount0Desired.quotient,
                amount1MinLessThanDesired: amount1Min.quotient <= amount1Desired.quotient,
              },
            })
          }
        }

        // Step 2: Validate tick range and spacing
        const tickSpacing = (await import('@uniswap/v3-sdk')).TICK_SPACINGS[fee]
        if (!tickSpacing) {
          throw new Error(`Invalid fee tier: ${fee}. Supported fees: 100, 500, 3000, 10000`)
        }

        // Ensure ticks are aligned to tick spacing
        const { nearestUsableTick } = await import('@uniswap/v3-sdk')
        const alignedTickLower = nearestUsableTick(tickLower, tickSpacing)
        const alignedTickUpper = nearestUsableTick(tickUpper, tickSpacing)

        if (alignedTickLower !== tickLower || alignedTickUpper !== tickUpper) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[useV3MintPosition] Ticks were adjusted to align with tick spacing', {
              originalTickLower: tickLower,
              originalTickUpper: tickUpper,
              alignedTickLower,
              alignedTickUpper,
              tickSpacing,
            })
          }
        }

        // Dev-only: log tick diagnostics
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] tick diagnostics', {
            tickLower: alignedTickLower,
            tickUpper: alignedTickUpper,
            tickSpacing,
            tickRangeValid: alignedTickLower < alignedTickUpper,
            tickLowerAligned: alignedTickLower % tickSpacing === 0,
            tickUpperAligned: alignedTickUpper % tickSpacing === 0,
          })
        }

        // Dev-only: log amount diagnostics
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] amount diagnostics', {
            amount0Desired: positionAmounts.amount0.toExact(),
            amount1Desired: positionAmounts.amount1.toExact(),
            amount0Min: amount0Min.toExact(),
            amount1Min: amount1Min.toExact(),
            amount0DesiredGT0: positionAmounts.amount0.quotient > 0n,
            amount1DesiredGT0: positionAmounts.amount1.quotient > 0n,
            amount0MinGT0: amount0Min.quotient >= 0n,
            amount1MinGT0: amount1Min.quotient >= 0n,
          })
        }

        // Ensure we have an initial price when creating the pool
        if (shouldCreatePoolOnChain && !sqrtPriceX96ForCall) {
          throw new Error('Initial price (sqrtPriceX96) is required to create and initialize a new V3 pool on-chain.')
        }

        // Step 3: Build transaction with fresh deadline
        // For on-chain enabled chains, always compute a fresh deadline at transaction build time
        // This ensures the deadline is never stale, even if the query result is cached
        const isOnChainEnabled = isOnChainRouterEnabled(chainId)
        const DEFAULT_TTL_MINUTES = 20 // Default TTL in minutes
        const freshDeadline = isOnChainEnabled
          ? Math.floor(Date.now() / 1000) + DEFAULT_TTL_MINUTES * 60 // Always fresh for on-chain chains
          : getDeadline(DEFAULT_TTL_MINUTES) // Use helper for non-on-chain chains (maintains existing behavior)

        // Get current block timestamp for deadline comparison (helps debug "Transaction too old" errors)
        let blockTimestamp: bigint | undefined
        try {
          const block = await publicClient.getBlock()
          blockTimestamp = block.timestamp
        } catch (error) {
          // If block fetch fails, we'll just use Date.now() for comparison
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[useV3MintPosition] Failed to fetch block timestamp:', error)
          }
        }

        // Dev-only: log mint timing before building transaction
        if (process.env.NODE_ENV !== 'production') {
          const now = Math.floor(Date.now() / 1000)
          const deadlineDiff = freshDeadline - now
          const blockDeadlineDiff = blockTimestamp ? Number(blockTimestamp) - freshDeadline : undefined

          logger.info('[useV3MintPosition] mint timing', {
            tags: { file: 'useV3MintPosition', function: 'queryFn' },
            extra: {
              chainId,
              deadline: freshDeadline,
              now,
              deadlineDiff,
              blockTimestamp: blockTimestamp ? Number(blockTimestamp) : undefined,
              blockDeadlineDiff,
              isOnChainEnabled,
            },
          })
        }

        // Dev-only: log amounts being passed to buildMintPositionTx
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] Calling buildMintPositionTx with', {
            token0: {
              address: token0.address,
              symbol: token0.symbol,
              decimals: token0.decimals,
            },
            token1: {
              address: token1.address,
              symbol: token1.symbol,
              decimals: token1.decimals,
            },
            amount0Desired: {
              raw: positionAmounts.amount0.quotient.toString(),
              human: positionAmounts.amount0.toExact(),
              currency: positionAmounts.amount0.currency.symbol,
              decimals: positionAmounts.amount0.currency.decimals,
            },
            amount1Desired: {
              raw: positionAmounts.amount1.quotient.toString(),
              human: positionAmounts.amount1.toExact(),
              currency: positionAmounts.amount1.currency.symbol,
              decimals: positionAmounts.amount1.currency.decimals,
            },
            amount0Min: {
              raw: amount0Min.quotient.toString(),
              human: amount0Min.toExact(),
              currency: amount0Min.currency.symbol,
              decimals: amount0Min.currency.decimals,
            },
            amount1Min: {
              raw: amount1Min.quotient.toString(),
              human: amount1Min.toExact(),
              currency: amount1Min.currency.symbol,
              decimals: amount1Min.currency.decimals,
            },
            tickLower: alignedTickLower,
            tickUpper: alignedTickUpper,
            fee,
          })
        }

        // For new pools, pass undefined for pool so buildMintPositionTx knows to skip pool validation
        const txPayload = await buildMintPositionTx({
          token0,
          token1,
          fee,
          tickLower: alignedTickLower, // Use aligned ticks
          tickUpper: alignedTickUpper, // Use aligned ticks
          amount0Desired: positionAmounts.amount0,
          amount1Desired: positionAmounts.amount1,
          amount0Min,
          amount1Min,
          recipient: recipient as `0x${string}`,
          deadline: freshDeadline, // Always fresh for on-chain chains
          chainId,
          pool: poolState?.pool, // Only pass pool if it exists
          publicClient,
          createPool: shouldCreatePoolOnChain,
          sqrtPriceX96: shouldCreatePoolOnChain ? sqrtPriceX96ForCall : undefined,
        })

        // Dev-only: log call sequence for router debugging
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] built tx payload', {
            chainId,
            to: txPayload.to,
            callSequence: txPayload.callSequence,
            sqrtPriceX96: txPayload.sqrtPriceX96,
            selectorPrefix: txPayload.data.substring(0, 10),
        })
        }

        // Dev-only: log mint params before simulation
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] mint params', {
            chainId,
            token0: token0.address,
            token1: token1.address,
            fee,
            tickLower: alignedTickLower,
            tickUpper: alignedTickUpper,
            amount0Desired: positionAmounts.amount0.toExact(),
            amount1Desired: positionAmounts.amount1.toExact(),
            amount0Min: amount0Min.toExact(),
            amount1Min: amount1Min.toExact(),
            recipient,
            poolExists: !!poolState?.pool,
            poolAddress,
            positionManagerAddress: txPayload.to,
            deadline: freshDeadline,
          })
        }

        // Step 4: Simulate transaction to catch reverts early.
        // Skip simulation when we are creating a brand new pool, because createAndInitializePoolIfNecessary
        // requires state changes and will always fail under eth_call. Upstream also avoids simulating
        // create+init flows and lets the transaction proceed to signing.
        const simulationAccount = (accountAddress || recipient) as `0x${string}` | undefined
        if (simulationAccount && !shouldCreatePoolOnChain) {
          try {
            const simulation = await simulateTransaction(publicClient, {
              to: txPayload.to as `0x${string}`,
              data: txPayload.data as `0x${string}`,
              value: BigInt(txPayload.value === '0x0' ? '0' : txPayload.value),
              account: simulationAccount,
            })

            if (!simulation.success) {
              let errorReason = simulation.reason || 'Unknown error'
              let userFriendlyError = errorReason

              if (errorReason.includes('Transaction too old') || errorReason.includes('too old')) {
                const now = Math.floor(Date.now() / 1000)
                const deadlineDiff = freshDeadline - now
                userFriendlyError =
                  'The transaction deadline has expired. Please retry to get a new transaction with a fresh deadline.'
                errorReason = `Transaction too old: deadline=${freshDeadline}, now=${now}, diff=${deadlineDiff}s`
                logger.error(new Error(errorReason), {
                  tags: { file: 'useV3MintPosition', function: 'simulation' },
                  extra: {
                    chainId,
                    deadline: freshDeadline,
                    now,
                    deadlineDiff,
                    blockTimestamp: blockTimestamp ? Number(blockTimestamp) : undefined,
                    blockDeadlineDiff: blockTimestamp ? Number(blockTimestamp) - freshDeadline : undefined,
                    isOnChainEnabled,
                  },
                })
              } else if (slot0 && slot0.sqrtPriceX96 === 0n) {
                userFriendlyError =
                  'Pool is not initialized for this pair and fee tier. Pool initialization is required before minting.'
                errorReason = `Pool not initialized: ${poolAddress}`
              } else if (!poolCodeExists) {
                userFriendlyError = 'Pool does not exist for this pair and fee tier. Pool creation is required before minting.'
                errorReason = `Pool does not exist: ${poolAddress}`
              } else if (errorReason.includes('0x88316456')) {
                userFriendlyError = `Mint transaction would revert. ${
                  slot0 ? 'Pool exists but mint failed.' : 'Pool may not be initialized.'
                } Check tick range, amounts, and approvals.`
                errorReason = `Mint revert (0x88316456): ${errorReason}`
              }

              const errorMessage = `Transaction would revert: ${userFriendlyError}`
              logger.error(new Error(errorMessage), {
                tags: {
                  file: 'useV3MintPosition',
                  function: 'useV3MintPosition',
                },
                extra: {
                  token0: token0.symbol,
                  token1: token1.symbol,
                  fee,
                  tickLower: alignedTickLower,
                  tickUpper: alignedTickUpper,
                  chainId,
                  revertReason: errorReason,
                  poolExists: !!poolState?.pool,
                  poolInitialized: slot0 ? slot0.sqrtPriceX96 > 0n : false,
                  poolAddress,
                  amount0Desired: positionAmounts.amount0.toExact(),
                  amount1Desired: positionAmounts.amount1.toExact(),
                },
              })
              if (process.env.NODE_ENV !== 'production') {
                console.error('[useV3MintPosition] mint simulation failed', {
                  chainId,
                  errorMessage,
                  revertReason: errorReason,
                  userFriendlyError,
                  token0: token0.address,
                  token1: token1.address,
                  fee,
                  tickLower: alignedTickLower,
                  tickUpper: alignedTickUpper,
                  tickSpacing,
                  amount0Desired: positionAmounts.amount0.toExact(),
                  amount1Desired: positionAmounts.amount1.toExact(),
                  poolExists: !!poolState?.pool,
                  poolCodeExists,
                  poolInitialized: slot0 ? slot0.sqrtPriceX96 > 0n : false,
                  poolAddress,
                })
              }
              const structuredError = new Error(errorMessage) as Error & {
                reason: string
                poolDiagnostics: {
                  poolAddress: string
                  poolCodeExists: boolean
                  poolInitialized: boolean
                  slot0: typeof slot0
                }
                tickDiagnostics: {
                  tickLower: number
                  tickUpper: number
                  tickSpacing: number
                }
                amountDiagnostics: {
                  amount0Desired: string
                  amount1Desired: string
                  amount0Min: string
                  amount1Min: string
                }
              }
              structuredError.reason = errorReason
              structuredError.poolDiagnostics = {
                poolAddress,
                poolCodeExists,
                poolInitialized: slot0 ? slot0.sqrtPriceX96 > 0n : false,
                slot0,
              }
              structuredError.tickDiagnostics = {
                tickLower: alignedTickLower,
                tickUpper: alignedTickUpper,
                tickSpacing,
              }
              structuredError.amountDiagnostics = {
                amount0Desired: positionAmounts.amount0.toExact(),
                amount1Desired: positionAmounts.amount1.toExact(),
                amount0Min: amount0Min.toExact(),
                amount1Min: amount1Min.toExact(),
              }
              throw structuredError
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes('would revert')) {
              throw error
            }
            if (process.env.NODE_ENV !== 'production') {
              console.error('[useV3MintPosition] Transaction simulation failed', {
                chainId,
                errorMessage: error instanceof Error ? error.message : String(error),
                errorData: (error as any)?.data,
                errorCode: (error as any)?.code,
                token0: token0.address,
                token1: token1.address,
                fee,
                tickLower,
                tickUpper,
              })
            }
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Transaction simulation failed: ${errorMessage}`)
          }
        } else if (shouldCreatePoolOnChain && process.env.NODE_ENV !== 'production') {
          console.log('[useV3MintPosition] Skipping simulation for create+init path (matches upstream behavior)', {
            chainId,
            poolAddress,
            createPool: shouldCreatePoolOnChain,
            sqrtPriceX96ForCall,
            callSequence: txPayload.callSequence,
          })
        }

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
    slippageNumeratorStr,
    slippageDenominatorStr,
    chainId,
    recipient,
    publicClient,
    accountAddress,
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

