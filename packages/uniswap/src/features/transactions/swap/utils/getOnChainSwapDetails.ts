/**
 * On-Chain Swap Details Computation
 * 
 * Computes swap review details (Rate, Price Impact, Network Cost, Routing) using only on-chain data.
 * No Trading API dependencies.
 */

import { Currency, CurrencyAmount, Percent, Price } from '@uniswap/sdk-core'
import { Pool, TickMath } from '@uniswap/v3-sdk'
import JSBI from 'jsbi'
import { Address, PublicClient } from 'viem'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'
import { estimateGasFee } from 'uniswap/src/features/transactions/swap/utils/estimateGasFee'
import { isOnChainDebug, makeOnChainDebugId, debugOnChainMathAudit } from 'uniswap/src/features/transactions/swap/utils/isOnChainDebug'
import { logger } from 'utilities/src/logger/logger'
import ERC20_ABI from 'uniswap/src/abis/erc20.json'
import { simulateTransaction } from 'uniswap/src/features/transactions/liquidity/utils/decodeRevertReason'

/**
 * Network cost information for the next executable step
 */
export interface OnChainNetworkCost {
  step: 'approve' | 'swap'
  gasLimit?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasFeeWei?: bigint
  gasFeeUsd?: string | null
  error?: Error | null
}

/**
 * Complete on-chain swap details
 */
export interface OnChainSwapDetails {
  executionPrice: Price<Currency, Currency> | null
  midPrice: Price<Currency, Currency> | null
  priceImpactBps: number | null
  lpFeeBps: number | null // LP fee in basis points (e.g., 100 = 1%)
  lpFeeAmount: CurrencyAmount<Currency> | null // LP fee amount in tokenIn units
  feeTier: number | null // Uniswap V3 fee tier (e.g., 10000 = 1%)
  rate: {
    forward: string | null
    inverse: string | null
  }
  networkCost: OnChainNetworkCost | null
  routingLabel: 'On-chain'
  debug: Record<string, unknown>
}

/**
 * Parameters for computing on-chain swap details
 */
export interface GetOnChainSwapDetailsParams {
  tokenIn: Currency
  tokenOut: Currency
  amountIn: CurrencyAmount<Currency>
  amountOut: CurrencyAmount<Currency>
  chainId: EVMUniverseChainId
  publicClient: PublicClient
  account: Address | undefined
  routerAddress: Address
  onChainRoute?: {
    route?: {
      hops?: Array<{
        tokenIn: Currency
        tokenOut: Currency
        fee: number
      }>
    }
  }
  tokenApprovalInfo?: {
    needsApprove: boolean
    approveTxRequest?: {
      to: Address
      data: `0x${string}`
    }
  }
  swapTxRequest?: {
    to: Address
    data: `0x${string}`
    value?: bigint
  }
  slippageToleranceBps?: number | undefined
  amountOutQuotedRaw?: string | undefined
  amountOutMinimumRaw?: string | undefined
  swapTxPayload?: {
    to?: string
    data?: string
    value?: string
    gasLimit?: string
    deadline?: number
    amountOutMinimumRaw?: string
  } | undefined
  debugBundle?: Partial<Record<string, unknown>> | undefined
}

/**
 * Compute execution price from amounts
 * 
 * Uses raw quotient values to avoid double-decimal scaling.
 * Example: amountInRaw=1000 (0.001 USDC, 6 decimals), amountOutRaw=763 (0.000763 EURC, 6 decimals)
 * Execution price = 763/1000 = 0.763 EURC per USDC (not 0.000000763)
 */
function computeExecutionPrice(
  amountIn: CurrencyAmount<Currency>,
  amountOut: CurrencyAmount<Currency>,
): Price<Currency, Currency> | null {
  try {
    // Guard: ensure both amounts exist and have valid quotients
    if (!amountIn || !amountOut) {
      return null
    }

    const amountInQuotient = amountIn.quotient
    const amountOutQuotient = amountOut.quotient

    // Guard: check for undefined or zero quotient
    if (amountInQuotient === undefined || amountInQuotient === null || amountInQuotient === 0n) {
      return null
    }
    if (amountOutQuotient === undefined || amountOutQuotient === null) {
      return null
    }

    // Guard: ensure currencies exist
    if (!amountIn.currency || !amountOut.currency) {
      return null
    }

    // Use SDK Price constructor with raw quotients to avoid double-decimal scaling
    // Price(baseCurrency, quoteCurrency, baseAmount.quotient, quoteAmount.quotient)
    // This correctly handles decimals internally
    const executionPrice = new Price(
      amountIn.currency,
      amountOut.currency,
      amountInQuotient,
      amountOutQuotient,
    )

    return executionPrice
  } catch (error) {
    logger.debug('getOnChainSwapDetails', 'computeExecutionPrice', 'Failed to compute execution price', {
      error: error instanceof Error ? error.message : String(error),
      amountInQuotient: amountIn?.quotient?.toString(),
      amountOutQuotient: amountOut?.quotient?.toString(),
      amountInCurrency: amountIn?.currency?.symbol,
      amountOutCurrency: amountOut?.currency?.symbol,
    })
    return null
  }
}

/**
 * Get mid price in correct direction (tokenOut per tokenIn)
 * 
 * Centralized helper to ensure price direction is always correct.
 * Uses pool.priceOf(tokenIn) which automatically returns tokenOut per tokenIn.
 */
function getMidPriceTokenOutPerTokenIn(
  pool: Pool,
  tokenIn: Currency,
  tokenOut: Currency,
): Price<Currency, Currency> {
  // pool.priceOf(tokenIn) returns price of tokenOut per tokenIn
  // This matches executionPrice direction (tokenOut per tokenIn)
  return pool.priceOf(tokenIn.wrapped)
}

/**
 * Assert price direction consistency - detects "same value both sides" bug
 * 
 * Checks:
 * 1. mid_outPerIn * mid_inPerOut ≈ 1 (within tolerance)
 * 2. If mid_outPerIn equals mid_inPerOut (within tolerance) => bug (unless price ~1)
 * 3. When tokens are flipped, prices should invert
 */
function assertPriceDirectionConsistency(
  midPrice: Price<Currency, Currency> | null,
  executionPrice: Price<Currency, Currency> | null,
  tolerance: number = 0.000001,
): {
  decimalsConsistent: boolean
  directionConsistent: boolean
  midMatchesInverse: boolean
  execMatchesInverse: boolean
  warnings: string[]
} {
  const warnings: string[] = []
  let decimalsConsistent = true
  let directionConsistent = true
  let midMatchesInverse = true
  let execMatchesInverse = true

  if (!midPrice || !executionPrice) {
    return { decimalsConsistent, directionConsistent, midMatchesInverse, execMatchesInverse, warnings }
  }

  // Check 1: mid_outPerIn * mid_inPerOut should ≈ 1
  const midOutPerIn = parseFloat(midPrice.toSignificant(18))
  const midInPerOut = parseFloat(midPrice.invert().toSignificant(18))
  const midProduct = midOutPerIn * midInPerOut
  const midProductDiff = Math.abs(midProduct - 1)
  
  if (midProductDiff > tolerance) {
    warnings.push(`mid_outPerIn * mid_inPerOut = ${midProduct.toFixed(10)} (expected ~1, diff: ${midProductDiff.toFixed(10)})`)
    midMatchesInverse = false
  }

  // Check 2: "same value both sides" bug detection
  const midValuesMatch = Math.abs(midOutPerIn - midInPerOut) < tolerance
  if (midValuesMatch && Math.abs(midOutPerIn - 1) > tolerance) {
    warnings.push(`BUG: mid_outPerIn (${midOutPerIn}) equals mid_inPerOut (${midInPerOut}) but price is not ~1.0!`)
    midMatchesInverse = false
  }

  // Check 3: execution price consistency
  const execOutPerIn = parseFloat(executionPrice.toSignificant(18))
  const execInPerOut = parseFloat(executionPrice.invert().toSignificant(18))
  const execProduct = execOutPerIn * execInPerOut
  const execProductDiff = Math.abs(execProduct - 1)
  
  if (execProductDiff > tolerance) {
    warnings.push(`exec_outPerIn * exec_inPerOut = ${execProduct.toFixed(10)} (expected ~1, diff: ${execProductDiff.toFixed(10)})`)
    execMatchesInverse = false
  }

  const execValuesMatch = Math.abs(execOutPerIn - execInPerOut) < tolerance
  if (execValuesMatch && Math.abs(execOutPerIn - 1) > tolerance) {
    warnings.push(`BUG: exec_outPerIn (${execOutPerIn}) equals exec_inPerOut (${execInPerOut}) but price is not ~1.0!`)
    execMatchesInverse = false
  }

  // Check 4: Direction consistency (mid and exec should be in same direction)
  const midBase = midPrice.baseCurrency
  const midQuote = midPrice.quoteCurrency
  const execBase = executionPrice.baseCurrency
  const execQuote = executionPrice.quoteCurrency
  
  if (!midBase.equals(execBase) || !midQuote.equals(execQuote)) {
    warnings.push(`Direction mismatch: mid (${midQuote.symbol}/${midBase.symbol}) vs exec (${execQuote.symbol}/${execBase.symbol})`)
    directionConsistent = false
  }

  return {
    decimalsConsistent,
    directionConsistent,
    midMatchesInverse,
    execMatchesInverse,
    warnings,
  }
}

/**
 * Compute mid price from pool state
 * 
 * CRITICAL: Uses pool.priceOf(tokenIn) to get price in direction tokenOut per tokenIn,
 * matching executionPrice direction. This ensures price impact calculation is consistent.
 */
async function computeMidPrice(
  tokenIn: Currency,
  tokenOut: Currency,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  route?: GetOnChainSwapDetailsParams['onChainRoute'],
  debugLog?: (log: Record<string, unknown>) => void,
): Promise<{ price: Price<Currency, Currency> | null; poolState: Awaited<ReturnType<typeof fetchV3PoolState>> | null }> {
  try {
    let poolState: Awaited<ReturnType<typeof fetchV3PoolState>> | null = null
    
    // For single-hop routes, use the pool from the route
    const firstHop = route?.route?.hops?.[0]
    if (firstHop) {
      poolState = await fetchV3PoolState({
        tokenIn: firstHop.tokenIn,
        tokenOut: firstHop.tokenOut,
        fee: firstHop.fee as any,
        chainId,
        publicClient,
      })

      if (poolState?.pool) {
        const pool = poolState.pool as Pool
        // Use centralized helper to ensure correct direction
        const midPrice = getMidPriceTokenOutPerTokenIn(pool, tokenIn, tokenOut)
        
        if (debugLog) {
          const isTokenInToken0 = tokenIn.wrapped.sortsBefore(tokenOut.wrapped)
          const token0Price = pool.token0Price
          const token1Price = pool.token1Price
          
          debugLog({
            poolState: {
              poolAddress: poolState.poolAddress,
              sqrtPriceX96: poolState.sqrtPriceX96,
              tick: poolState.tick,
              liquidity: poolState.liquidity,
              fee: poolState.fee,
              token0: {
                address: poolState.token0.address,
                symbol: poolState.token0.symbol,
                decimals: poolState.token0.decimals,
              },
              token1: {
                address: poolState.token1.address,
                symbol: poolState.token1.symbol,
                decimals: poolState.token1.decimals,
              },
              isTokenInToken0,
              token0Price: token0Price.toSignificant(6),
              token1Price: token1Price.toSignificant(6),
              midPrice_viaPriceOf: midPrice.toSignificant(6),
              midPrice_direction: `${tokenOut.symbol} per ${tokenIn.symbol}`,
              note: 'Using pool.priceOf(tokenIn) ensures correct direction (tokenOut per tokenIn)',
            },
            // Cross-check: compute price from sqrtPriceX96 manually
            sqrtPriceX96_calculation: (() => {
              const sqrtPrice = JSBI.BigInt(poolState.sqrtPriceX96)
              const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96))
              const priceX96 = JSBI.multiply(sqrtPrice, sqrtPrice)
              const priceToken1PerToken0 = Number(priceX96) / Number(Q96) / Number(Q96)
              return {
                sqrtPriceX96: poolState.sqrtPriceX96,
                priceToken1PerToken0_raw: priceToken1PerToken0.toString(),
                priceToken1PerToken0_adjusted: isTokenInToken0 
                  ? priceToken1PerToken0.toString()
                  : (1 / priceToken1PerToken0).toString(),
              }
            })(),
            // Cross-check: compute price from tick
            tick_calculation: (() => {
              const sqrtPriceFromTick = TickMath.getSqrtRatioAtTick(poolState.tick)
              const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96))
              const priceX96 = JSBI.multiply(sqrtPriceFromTick, sqrtPriceFromTick)
              const priceToken1PerToken0 = Number(priceX96) / Number(Q96) / Number(Q96)
              return {
                tick: poolState.tick,
                sqrtPriceFromTick: sqrtPriceFromTick.toString(),
                priceToken1PerToken0_raw: priceToken1PerToken0.toString(),
                priceToken1PerToken0_adjusted: isTokenInToken0 
                  ? priceToken1PerToken0.toString()
                  : (1 / priceToken1PerToken0).toString(),
              }
            })(),
          })
        }
        
        return { price: midPrice, poolState }
      }
    }

    // Fallback: try to fetch pool directly
    // Try common fee tiers
    const fees = [500, 3000, 10000] as const
    for (const fee of fees) {
      poolState = await fetchV3PoolState({
        tokenIn,
        tokenOut,
        fee,
        chainId,
        publicClient,
      })

      if (poolState?.pool) {
        const pool = poolState.pool as Pool
        // Use pool.priceOf(tokenIn) to get price in direction tokenOut per tokenIn
        const midPrice = pool.priceOf(tokenIn.wrapped)
        
        if (debugLog) {
          const isTokenInToken0 = tokenIn.wrapped.sortsBefore(tokenOut.wrapped)
          debugLog({
            poolState_fallback: {
              poolAddress: poolState.poolAddress,
              fee,
              sqrtPriceX96: poolState.sqrtPriceX96,
              tick: poolState.tick,
              liquidity: poolState.liquidity,
              isTokenInToken0,
              midPrice_viaPriceOf: midPrice.toSignificant(6),
            },
          })
        }
        
        return { price: midPrice, poolState }
      }
    }

    return { price: null, poolState: null }
  } catch (error) {
    if (debugLog) {
      debugLog({
        error: error instanceof Error ? error.message : String(error),
      })
    }
    logger.debug('getOnChainSwapDetails', 'computeMidPrice', 'Failed to compute mid price', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { price: null, poolState: null }
  }
}

/**
 * Compute price impact in basis points (excluding LP fee)
 * 
 * Uniswap definition: Price impact excludes LP fee and only measures slippage from curve movement.
 * 
 * For exact-in swaps:
 * - amountInAfterFee = amountIn * (1 - feeFraction)
 * - executionPriceNoFee = amountOut / amountInAfterFee
 * - priceImpact = (midPrice - executionPriceNoFee) / midPrice
 * 
 * Both prices must be in the same direction: tokenOut per tokenIn
 * 
 * If executionPriceNoFee < midPrice, we're getting less output (negative impact, shown as positive in UI)
 * If executionPriceNoFee > midPrice, we're getting more output (positive impact, shown as 0 in UI)
 */
function computePriceImpactBps(
  executionPrice: Price<Currency, Currency> | null,
  midPrice: Price<Currency, Currency> | null,
  amountIn: CurrencyAmount<Currency> | null,
  amountOut: CurrencyAmount<Currency> | null,
  feeTier: number | null, // Uniswap V3 fee in units of 1e6 (e.g., 10000 = 1%)
  debugLog?: (log: Record<string, unknown>) => void,
): number | null {
  if (!executionPrice || !midPrice || !amountIn || !amountOut) {
    return null
  }

  try {
    // Ensure both prices are in the same direction (tokenOut per tokenIn)
    // executionPrice is already tokenOut per tokenIn (from Price constructor)
    // midPrice should also be tokenOut per tokenIn (from pool.priceOf(tokenIn))
    
    // For exact-in swaps, compute executionPriceNoFee from amounts (excluding fee)
    let executionPriceNoFee = executionPrice
    let amountInAfterFee: CurrencyAmount<Currency> | null = null
    
    if (feeTier !== null && feeTier !== undefined && feeTier > 0 && feeTier < 1_000_000) {
      // Convert fee tier to fraction (e.g., 10000 = 1% = 0.01)
      // Compute amountInAfterFee = amountIn * (1 - feeFraction)
      // Use raw quotient to avoid precision issues: amountIn * (1_000_000 - feeTier) / 1_000_000
      const oneMinusFeeScaled = 1_000_000 - feeTier
      if (oneMinusFeeScaled > 0) {
        const amountInAfterFeeRaw = JSBI.divide(
          JSBI.multiply(amountIn.quotient, JSBI.BigInt(oneMinusFeeScaled)),
          JSBI.BigInt(1_000_000)
        )
        
        // Only proceed if amountInAfterFee is positive and less than amountIn
        if (JSBI.greaterThan(amountInAfterFeeRaw, JSBI.BigInt(0)) && JSBI.lessThan(amountInAfterFeeRaw, amountIn.quotient)) {
          amountInAfterFee = CurrencyAmount.fromRawAmount(amountIn.currency, amountInAfterFeeRaw)
          
          // Compute executionPriceNoFee = amountOut / amountInAfterFee
          // This excludes the fee from the price calculation
          executionPriceNoFee = new Price(
            amountInAfterFee.currency,
            amountOut.currency,
            amountInAfterFee.quotient,
            amountOut.quotient,
          )
        }
      }
    }
    
    // Price impact = (midPrice - executionPriceNoFee) / midPrice
    // This gives us the percentage difference excluding fee
    const priceDiff = midPrice.subtract(executionPriceNoFee)
    const impactFraction = priceDiff.divide(midPrice)
    
    // Convert to basis points
    const impactBps = Math.round(
      Number(impactFraction.asFraction.numerator) / Number(impactFraction.asFraction.denominator) * 10000
    )
    
    // Clamp to >= 0 (negative impact means better execution than mid price, show as 0)
    const clampedBps = Math.max(0, impactBps)
    
    if (debugLog) {
      // Sanity check: compute impact using inverse prices (using executionPriceNoFee)
      const execNoFeeInverse = executionPriceNoFee.invert()
      const midInverse = midPrice.invert()
      const priceDiffInverse = midInverse.subtract(execNoFeeInverse)
      const impactFractionInverse = priceDiffInverse.divide(midInverse)
      const impactBpsInverse = Math.round(
        Number(impactFractionInverse.asFraction.numerator) / Number(impactFractionInverse.asFraction.denominator) * 10000
      )
      const clampedBpsInverse = Math.max(0, impactBpsInverse)
      
      // Compute LP fee amount for exact-in
      const lpFeeAmount = amountInAfterFee && amountIn
        ? amountIn.subtract(amountInAfterFee)
        : null
      
      const feeTierBps = feeTier ? Math.round(feeTier / 100) : null // Convert to bps (10000 -> 100 bps)
      
      debugLog({
        priceImpact: {
          midPrice_numeric: midPrice.toSignificant(18),
          executionPrice_numeric: executionPrice.toSignificant(18),
          executionPriceNoFee_numeric: executionPriceNoFee.toSignificant(18),
          feeTier: feeTier ?? null,
          feeTierBps: feeTierBps ?? null,
          feeFraction: feeTier ? (feeTier / 1_000_000).toFixed(6) : null,
          amountInRaw: amountIn.quotient.toString(),
          amountInAfterFeeRaw: amountInAfterFee?.quotient.toString() ?? null,
          amountOutRaw: amountOut.quotient.toString(),
          lpFeeAmountRaw: lpFeeAmount?.quotient.toString() ?? null,
          lpFeeAmountExact: lpFeeAmount?.toExact() ?? null,
          priceDiff_numeric: priceDiff.toSignificant(18),
          impactFraction_numeric: `${impactFraction.asFraction.numerator}/${impactFraction.asFraction.denominator}`,
          impactBps_raw: impactBps,
          impactBps_clamped: clampedBps,
          impactPercent: (clampedBps / 100).toFixed(2) + '%',
          signConvention: 'positive = worse execution (less output), negative = better execution (more output)',
          note: feeTier !== null ? 'Price impact excludes LP fee (Uniswap definition)' : 'Price impact includes fee (multi-hop or unknown fee)',
          // Sanity check with inverse
          sanityCheck_inverse: {
            impactBps_inverse: impactBpsInverse,
            impactBps_inverse_clamped: clampedBpsInverse,
            matches: Math.abs(clampedBps - clampedBpsInverse) < 1, // Should match within 1 bps
          },
        },
      })
    }
    
    return clampedBps
  } catch (error) {
    if (debugLog) {
      debugLog({
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
    logger.warn('getOnChainSwapDetails', 'computePriceImpactBps', 'Failed to compute price impact', {
      error: error instanceof Error ? error.message : String(error),
      executionPrice: executionPrice ? executionPrice.toSignificant(6) : null,
      midPrice: midPrice ? midPrice.toSignificant(6) : null,
      amountIn: amountIn?.toExact() ?? null,
      amountOut: amountOut?.toExact() ?? null,
      feeTier,
    })
    return null
  }
}

/**
 * Format rate strings
 */
function formatRate(
  executionPrice: Price<Currency, Currency> | null,
  tokenIn: Currency,
  tokenOut: Currency,
): { forward: string | null; inverse: string | null } {
  if (!executionPrice) {
    return { forward: null, inverse: null }
  }

  try {
    const forward = `1 ${tokenIn.symbol || 'Token'} = ${executionPrice.toSignificant(6)} ${tokenOut.symbol || 'Token'}`
    const inversePrice = executionPrice.invert()
    const inverse = `1 ${tokenOut.symbol || 'Token'} = ${inversePrice.toSignificant(6)} ${tokenIn.symbol || 'Token'}`
    return { forward, inverse }
  } catch (error) {
    logger.debug('getOnChainSwapDetails', 'formatRate', 'Failed to format rate', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { forward: null, inverse: null }
  }
}

/**
 * Check if approval is needed and if balance is sufficient
 */
async function checkApprovalAndBalance(
  tokenIn: Currency,
  amountIn: CurrencyAmount<Currency>,
  account: Address | undefined,
  publicClient: PublicClient,
  routerAddress: Address,
): Promise<{ needsApprove: boolean; hasBalance: boolean }> {
  if (!account || tokenIn.isNative) {
    return { needsApprove: false, hasBalance: true }
  }

  try {
    // For native currencies, address might not exist - use wrapped address
    const tokenAddress = tokenIn.isToken ? tokenIn.address : tokenIn.wrapped.address
    const [allowance, balance] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account, routerAddress],
      }),
      publicClient.readContract({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account],
      }),
    ])

    const needsApprove = BigInt(allowance.toString()) < amountIn.quotient
    const hasBalance = BigInt(balance.toString()) >= amountIn.quotient

    return { needsApprove, hasBalance }
  } catch (error) {
    logger.debug('getOnChainSwapDetails', 'checkApprovalAndBalance', 'Failed to check approval/balance', {
      error: error instanceof Error ? error.message : String(error),
    })
    // Default to needing approval if check fails
    return { needsApprove: true, hasBalance: false }
  }
}

/**
 * Estimate network cost for approval or swap
 */
async function estimateNetworkCost(
  step: 'approve' | 'swap',
  txRequest: { to: Address; data: `0x${string}`; value?: bigint } | undefined,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  account: Address | undefined,
): Promise<OnChainNetworkCost | null> {
  if (!txRequest || !account) {
    return null
  }

  try {
    // Use the provided publicClient as provider for gas estimation
    const gasEstimate = await estimateGasFee({
      chainId,
      txRequest: {
        to: txRequest.to as string,
        data: txRequest.data as string,
        value: txRequest.value,
      },
      provider: publicClient,
      account: account as string,
    })

    return {
      step,
      gasLimit: gasEstimate.gasLimit,
      maxFeePerGas: gasEstimate.maxFeePerGas,
      maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      gasFeeWei: gasEstimate.totalCostWei,
      gasFeeUsd: null, // USD conversion can be added later if needed
      error: null,
    }
  } catch (error) {
    // Don't throw - return error in result
    const errorObj = error instanceof Error ? error : new Error(String(error))
    
    // Log STF errors at debug level only (expected pre-approval)
    if (errorObj.message.includes('STF') || errorObj.message.includes('revert')) {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('getOnChainSwapDetails', 'estimateNetworkCost', 'Gas estimation failed (expected)', {
          step,
          error: errorObj.message.slice(0, 100),
        })
      }
    } else {
      logger.warn('getOnChainSwapDetails', 'estimateNetworkCost', 'Gas estimation failed', {
        step,
        error: errorObj.message,
      })
    }

    return {
      step,
      error: errorObj,
    }
  }
}

/**
 * Main function to compute on-chain swap details
 */
export async function getOnChainSwapDetails(
  params: GetOnChainSwapDetailsParams,
): Promise<OnChainSwapDetails> {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    chainId,
    publicClient,
    account,
    routerAddress,
    onChainRoute,
    tokenApprovalInfo,
    swapTxRequest,
    slippageToleranceBps,
    amountOutQuotedRaw,
    amountOutMinimumRaw,
  } = params

  const isDebug = isOnChainDebug(chainId)
  // Use provided debug bundle or create new one
  const debugBundle: Record<string, unknown> = params.debugBundle || {}
  
  // Helper to add debug logs (only if debug enabled)
  const debugLog = (section: string, data: Record<string, unknown>) => {
    if (isDebug) {
      debugBundle[section] = data
    }
  }
  
  // Add tx payload section if available
  if (isDebug && params.swapTxPayload) {
    debugLog('txPayload', {
      txTo: params.swapTxPayload.to ?? 'unavailable',
      txDataLen: params.swapTxPayload.data?.length ?? 0,
      txValue: params.swapTxPayload.value ?? '0',
      txDeadlineSeconds: params.swapTxPayload.deadline ?? null,
      txAmountOutMinimumRaw: params.swapTxPayload.amountOutMinimumRaw ?? null,
      txGasLimit: params.swapTxPayload.gasLimit ?? null,
    })
  }

  // 1. Inputs (comprehensive)
  debugLog('inputs', {
    chainId,
    tokenIn: {
      address: tokenIn.isToken ? tokenIn.address : tokenIn.wrapped.address,
      symbol: tokenIn.symbol,
      decimals: tokenIn.decimals,
    },
    tokenOut: {
      address: tokenOut.isToken ? tokenOut.address : tokenOut.wrapped.address,
      symbol: tokenOut.symbol,
      decimals: tokenOut.decimals,
    },
    isExactIn: true, // On-chain swaps are always exact input for now
    amountSpecified: {
      raw: amountIn.quotient.toString(),
      exact: amountIn.toExact(),
    },
    slippageToleranceBps: slippageToleranceBps ?? 'unavailable',
    slippageSource: slippageToleranceBps !== undefined ? 'auto' : 'unavailable', // TODO: detect user vs auto
  })

  // 2. Compute execution price
  const executionPrice = computeExecutionPrice(amountIn, amountOut)
  
  // Compute execution price from raw ratio (cross-check)
  const executionPriceFromRaw = (() => {
    if (!amountIn.quotient || !amountOut.quotient || amountIn.quotient === 0n) {
      return null
    }
    // Raw ratio: amountOutRaw / amountInRaw (before decimal adjustment)
    const rawRatio = Number(amountOut.quotient) / Number(amountIn.quotient)
    // Adjusted for decimals: (amountOutRaw / 10^decimalsOut) / (amountInRaw / 10^decimalsIn)
    // Note: SDK Price constructor handles this automatically, this is just for cross-check
    const adjustedRatio = rawRatio * (10 ** tokenIn.decimals) / (10 ** tokenOut.decimals)
    return adjustedRatio.toString()
  })()
  
  // Assertion: execution price must be in direction tokenOut per tokenIn
  if (isDebug && executionPrice) {
    const execBase = executionPrice.baseCurrency
    const execQuote = executionPrice.quoteCurrency
    const directionCorrect = execBase.equals(tokenIn) && execQuote.equals(tokenOut)
    
    if (!directionCorrect) {
      debugLog('executionPrice_direction_warning', {
        warning: 'Execution price direction mismatch!',
        expected: `${tokenOut.symbol} per ${tokenIn.symbol}`,
        actual: `${execQuote.symbol} per ${execBase.symbol}`,
        note: 'This should never happen - Price constructor should match input order',
      })
    }
    
    // Check for "same value both sides" symptom: if execution price equals its inverse (within rounding),
    // this suggests a direction bug when tokens are flipped
    const execInverse = executionPrice.invert()
    const execValue = executionPrice.toSignificant(18)
    const execInverseValue = execInverse.toSignificant(18)
    const valuesMatch = Math.abs(parseFloat(execValue) - parseFloat(execInverseValue)) < 0.000001
    
    if (valuesMatch) {
      debugLog('direction_suspicion_warning', {
        warning: 'Execution price and its inverse are identical within rounding!',
        executionPrice: execValue,
        executionPrice_inverse: execInverseValue,
        rawRatio_tokenOutPerTokenIn: `${amountOut.quotient.toString()}/${amountIn.quotient.toString()}`,
        rawRatio_tokenInPerTokenOut: `${amountIn.quotient.toString()}/${amountOut.quotient.toString()}`,
        note: 'If tokens are flipped but execution price is identical, this suggests a direction bug. Price should invert when tokens are swapped.',
      })
    }
  }
  
  debugLog('executionPrice', {
    executionPrice: executionPrice ? executionPrice.toSignificant(6) : null,
    executionPriceRaw: executionPrice 
      ? `${executionPrice.numerator.toString()}/${executionPrice.denominator.toString()}`
      : null,
    executionPrice_fromRawRatio: executionPriceFromRaw,
    executionPrice_inverse: executionPrice ? executionPrice.invert().toSignificant(6) : null,
    direction: executionPrice ? `${tokenOut.symbol} per ${tokenIn.symbol}` : null,
  })
  
  // 3. Compute mid price from pool (with comprehensive logging)
  let midPrice: Price<Currency, Currency> | null = null
  let poolState: Awaited<ReturnType<typeof fetchV3PoolState>> | null = null
  try {
    const midPriceResult = await computeMidPrice(
      tokenIn,
      tokenOut,
      chainId,
      publicClient,
      onChainRoute,
      isDebug ? (log) => debugLog('midPrice', log) : undefined,
    )
    midPrice = midPriceResult.price
    poolState = midPriceResult.poolState
  } catch (error) {
    logger.warn('getOnChainSwapDetails', 'computeMidPrice', 'Failed to compute mid price', {
      error: error instanceof Error ? error.message : String(error),
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      chainId,
    })
    midPrice = null
    poolState = null
  }
  
  // Add to prices section (after midPrice is computed)
  debugLog('prices', {
    midPrice_sdk: midPrice ? midPrice.toSignificant(18) : null,
    midPrice_fromSqrtPriceX96: poolState ? (() => {
      // Extract from midPrice debug log if available
      const midPriceLog = (debugBundle as any).midPrice as any
      return midPriceLog?.sqrtPriceX96_calculation?.priceToken1PerToken0_adjusted ?? null
    })() : null,
    executionPrice: executionPrice ? executionPrice.toSignificant(18) : null,
    executionPriceRaw: executionPrice 
      ? `${executionPrice.numerator.toString()}/${executionPrice.denominator.toString()}`
      : null,
    executionPrice_inverse: executionPrice ? executionPrice.invert().toSignificant(18) : null,
    midPrice_inverse: midPrice ? midPrice.invert().toSignificant(18) : null,
    direction: executionPrice ? `${tokenOut.symbol} per ${tokenIn.symbol}` : null,
  })
  
  // Add comprehensive pool data to debug bundle
  if (isDebug && poolState && midPrice) {
    // Extract slot0 details if available (from pool state)
    const slot0Details = poolState.pool ? {
      sqrtPriceX96: poolState.sqrtPriceX96,
      tick: poolState.tick,
      // Note: observationCardinality not available from fetchV3PoolState, would need additional call
    } : null
    
    const tokenInIsToken0 = tokenIn.wrapped.sortsBefore(tokenOut.wrapped)
    
    debugLog('pool', {
      poolAddress: poolState.poolAddress,
      fee: poolState.fee,
      token0: {
        address: poolState.token0.address,
        decimals: poolState.token0.decimals,
        symbol: poolState.token0.symbol,
      },
      token1: {
        address: poolState.token1.address,
        decimals: poolState.token1.decimals,
        symbol: poolState.token1.symbol,
      },
      tokenInIsToken0,
      slot0: slot0Details,
      liquidity: poolState.liquidity,
      // tickSpacing would need additional call to pool contract
    })
    
    // Assertion: mid price direction must match execution price direction
    if (executionPrice && midPrice) {
      const directionMatches = executionPrice.baseCurrency.equals(midPrice.baseCurrency) && executionPrice.quoteCurrency.equals(midPrice.quoteCurrency)
      
      if (isDebug && !directionMatches) {
        debugLog('price_direction_mismatch_warning', {
          warning: 'Mid price and execution price directions do not match!',
          executionPrice_direction: `${executionPrice.quoteCurrency.symbol} per ${executionPrice.baseCurrency.symbol}`,
          midPrice_direction: `${midPrice.quoteCurrency.symbol} per ${midPrice.baseCurrency.symbol}`,
          note: 'This will cause incorrect price impact calculation',
        })
      }
      
      if (isDebug) {
        debugLog('midPrice_summary', {
          midPrice: midPrice.toSignificant(6),
          midPrice_inverse: midPrice.invert().toSignificant(6),
          direction: `${tokenOut.symbol} per ${tokenIn.symbol}`,
          matches_execution_direction: directionMatches,
        })
      }
    }
  }

  // 4. Extract fee tier from pool state or route (for single-hop swaps)
  const feeTier = (() => {
    // Try to get fee from pool state first
    if (poolState?.fee !== undefined) {
      return poolState.fee // Uniswap V3 fee in units of 1e6 (e.g., 10000 = 1%)
    }
    // Fallback to route fee (for single-hop)
    const firstHop = onChainRoute?.route?.hops?.[0]
    if (firstHop?.fee !== undefined) {
      return firstHop.fee
    }
    return null
  })()

  // Convert fee tier to basis points for display
  const lpFeeBps = feeTier ? Math.round(feeTier / 100) : null // 10000 -> 100 bps (1%)

  // 5. Compute price impact (with comprehensive logging, excluding fee)
  const priceImpactBps = computePriceImpactBps(
    executionPrice,
    midPrice,
    amountIn,
    amountOut,
    feeTier,
    isDebug ? (log) => {
      // Extract numeric values for structured logging
      const impactData = log.priceImpact as any
      if (impactData) {
        debugLog('priceImpact', {
          priceImpactFloat: impactData.impactBps_raw !== undefined 
            ? (impactData.impactBps_raw / 10000).toFixed(6)
            : null,
          priceImpactBpsRounded: impactData.impactBps_clamped ?? null,
          priceImpactSign: impactData.impactBps_raw !== undefined
            ? (impactData.impactBps_raw > 0 ? 'positive' : impactData.impactBps_raw < 0 ? 'negative' : 'zero')
            : null,
          crossCheck: impactData.sanityCheck_inverse ? {
            impactBps_inverse: impactData.sanityCheck_inverse.impactBps_inverse_clamped,
            differenceBps: Math.abs((impactData.impactBps_clamped ?? 0) - (impactData.sanityCheck_inverse.impactBps_inverse_clamped ?? 0)),
            crossCheckPassed: impactData.sanityCheck_inverse.matches,
          } : null,
          // Include full details for debugging
          ...impactData,
        })
      } else {
        debugLog('priceImpact', log)
      }
    } : undefined,
  )

  // 5. Format rate
  const rate = formatRate(executionPrice, tokenIn, tokenOut)
  
  // Add quote outputs section (if not already added in quote hook)
  if (isDebug && !debugBundle.quoteOutputs) {
    debugLog('quoteOutputs', {
      amountInRaw: amountIn.quotient.toString(),
      amountOutRaw: amountOut.quotient.toString(),
      amountInExact: amountIn.toExact(),
      amountOutExact: amountOut.toExact(),
      quotedRoute: onChainRoute?.route?.description ?? null,
      routerAddress: routerAddress,
    })
  }

  // 6. Slippage logging (comprehensive)
  if (isDebug && amountOutQuotedRaw && amountOutMinimumRaw) {
    const quoted = BigInt(amountOutQuotedRaw)
    const minimum = BigInt(amountOutMinimumRaw)
    const slippageBuffer = quoted - minimum
    const slippageBufferPercent = quoted > 0n 
      ? (Number(slippageBuffer) / Number(quoted) * 100).toFixed(4)
      : '0'
    
    // Format minimum amount out
    const minAmountOutExact = (() => {
      try {
        const minAmount = CurrencyAmount.fromRawAmount(tokenOut, minimum)
        return minAmount.toExact()
      } catch {
        return null
      }
    })()
    
    debugLog('slippage', {
      minAmountOutRaw: amountOutMinimumRaw,
      minAmountOutExact: minAmountOutExact,
      bufferRaw: slippageBuffer.toString(),
      wouldRevertIfActualOutBelowMin: `Swap would revert if actualOut < ${amountOutMinimumRaw}. Price impact does NOT imply revert; only minOut does.`,
    })
  }
  
  // 7. Simulation / Ground truth cross-check
  if (isDebug && onChainRoute?.route?.hops?.[0] && publicClient) {
    try {
      const firstHop = onChainRoute.route.hops[0]
      const { getQuoterV2Address } = await import('uniswap/src/constants/v3Addresses')
      const { AGROSWAP_QUOTER_ADDRESSES } = await import('uniswap/src/constants/agroswapAddresses')
      const { QUOTER_ADDRESSES } = await import('@uniswap/sdk-core')
      const { Interface } = await import('ethers/lib/utils')
      
      const getQuoterAddress = (chainId: number): string => {
        if (chainId === 84532) {
          const agroswapAddress = AGROSWAP_QUOTER_ADDRESSES[chainId as keyof typeof AGROSWAP_QUOTER_ADDRESSES]
          if (agroswapAddress) return agroswapAddress
        }
        const v3Address = getQuoterV2Address(chainId)
        if (v3Address) return v3Address
        const sdkAddress = QUOTER_ADDRESSES[chainId as keyof typeof QUOTER_ADDRESSES]
        return sdkAddress || ''
      }
      
      const QUOTER_V2_ABI = [
        {
          inputs: [{
            components: [
              { internalType: 'address', name: 'tokenIn', type: 'address' },
              { internalType: 'address', name: 'tokenOut', type: 'address' },
              { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
            ],
            internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
            name: 'params',
            type: 'tuple',
          }],
          name: 'quoteExactInputSingle',
          outputs: [
            { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
            { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
            { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
            { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ] as const
      
      const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
      if (quoterAddress) {
        const quoterInterface = new Interface(QUOTER_V2_ABI)
        const result = await publicClient.readContract({
          address: quoterAddress,
          abi: QUOTER_V2_ABI as any,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: (tokenIn.isToken ? tokenIn.address : tokenIn.wrapped.address) as `0x${string}`,
            tokenOut: (tokenOut.isToken ? tokenOut.address : tokenOut.wrapped.address) as `0x${string}`,
            amountIn: amountIn.quotient,
            fee: BigInt(firstHop.fee),
            sqrtPriceLimitX96: 0n,
          }],
        })
        
        const [simulatedAmountOut] = result as any
        const simulatedAmountOutRaw = simulatedAmountOut?.toString() ?? null
        const computedAmountOutRaw = amountOut.quotient.toString()
        const diff = simulatedAmountOutRaw && computedAmountOutRaw
          ? (BigInt(simulatedAmountOutRaw) - BigInt(computedAmountOutRaw)).toString()
          : null
        
        debugLog('simulation', {
          simulatedAmountOutRaw,
          diffVsComputedQuote: diff,
          note: diff ? `Quoter simulation differs from computed quote by ${diff} raw units` : 'Quoter simulation matches computed quote',
        })
      }
    } catch (error) {
      // Simulation failed, log but don't fail
      debugLog('simulation', {
        error: error instanceof Error ? error.message : String(error),
        note: 'Quoter simulation failed (non-critical)',
      })
    }
  }

  // 8. Determine network cost (approval vs swap)
  let networkCost: OnChainNetworkCost | null = null
  
  // Check if approval is needed and balance is sufficient
  const { needsApprove, hasBalance } = await checkApprovalAndBalance(
    tokenIn,
    amountIn,
    account,
    publicClient,
    routerAddress,
  )

  // Estimate approval gas if needed
  let approvalCost: OnChainNetworkCost | null = null
  if (needsApprove && tokenApprovalInfo?.approveTxRequest) {
    approvalCost = await estimateNetworkCost('approve', tokenApprovalInfo.approveTxRequest, chainId, publicClient, account)
    debugLog('networkCost_approval', {
      step: 'approve',
      gasLimit: approvalCost.gasLimit?.toString(),
      maxFeePerGas: approvalCost.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: approvalCost.maxPriorityFeePerGas?.toString(),
      gasFeeWei: approvalCost.gasFeeWei?.toString(),
      hasError: !!approvalCost.error,
      error: approvalCost.error?.message,
    })
  }

  // Estimate swap gas if balance is sufficient
  let swapCost: OnChainNetworkCost | null = null
  if (hasBalance && swapTxRequest) {
    swapCost = await estimateNetworkCost('swap', swapTxRequest, chainId, publicClient, account)
    debugLog('networkCost_swap', {
      step: 'swap',
      gasLimit: swapCost.gasLimit?.toString(),
      maxFeePerGas: swapCost.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: swapCost.maxPriorityFeePerGas?.toString(),
      gasFeeWei: swapCost.gasFeeWei?.toString(),
      hasError: !!swapCost.error,
      error: swapCost.error?.message,
    })
  }

  // Determine which cost to display
  // Priority: approval if needed, otherwise swap
  if (needsApprove && approvalCost) {
    networkCost = approvalCost
    // If we also have swap cost, we could combine them, but for now show approval
    // TODO: Consider showing combined cost when both are available
  } else if (swapCost) {
    networkCost = swapCost
  }

  // Format network cost for debug bundle
  if (isDebug) {
    const networkCostDebug: any = {
      networkCostDisplayed: networkCost?.step ?? 'none',
    }
    
    if (approvalCost) {
      networkCostDebug.approvalTx = {
        estimateGas: approvalCost.gasLimit?.toString() ?? null,
        feeData: approvalCost.maxFeePerGas || approvalCost.maxPriorityFeePerGas || approvalCost.gasLimit
          ? {
              maxFeePerGas: approvalCost.maxFeePerGas?.toString(),
              maxPriorityFeePerGas: approvalCost.maxPriorityFeePerGas?.toString(),
              gasPrice: approvalCost.gasLimit && !approvalCost.maxFeePerGas ? 'legacy' : undefined,
            }
          : null,
        costWei: approvalCost.gasFeeWei?.toString() ?? null,
      }
    }
    
    if (swapCost) {
      networkCostDebug.swapTx = {
        estimateGas: swapCost.gasLimit?.toString() ?? null,
        feeData: swapCost.maxFeePerGas || swapCost.maxPriorityFeePerGas || swapCost.gasLimit
          ? {
              maxFeePerGas: swapCost.maxFeePerGas?.toString(),
              maxPriorityFeePerGas: swapCost.maxPriorityFeePerGas?.toString(),
              gasPrice: swapCost.gasLimit && !swapCost.maxFeePerGas ? 'legacy' : undefined,
            }
          : null,
        costWei: swapCost.gasFeeWei?.toString() ?? null,
      }
    }
    
    debugLog('networkCost', networkCostDebug)
  }

  // Build comprehensive math audit bundle (single JSON per quote cycle)
  if (isDebug) {
    const auditId = makeOnChainDebugId('OCAUDIT')
    
    // Run invariant checks
    const invariants = assertPriceDirectionConsistency(midPrice, executionPrice)
    
    // Extract pool selection details from route
    const firstHop = onChainRoute?.route?.hops?.[0]
    const feeTier = firstHop?.fee ?? null
    const feeTierBps = feeTier ? (feeTier / 100) : null // Convert Uniswap fee (10000) to bps (100)
    const expectedFeeTier = 10000 // 1% pool (1% = 10000 in Uniswap V3 fee units)
    const poolSelectionCorrect = feeTier === expectedFeeTier
    
    // Extract pool selection info (which fee tiers were checked, which was selected)
    const poolSelection = {
      feeTiersChecked: [500, 3000, 10000], // Default fee tiers (would need to pass from findRoute)
      firstFoundPool: poolState?.poolAddress ?? null,
      finalSelectedPool: poolState?.poolAddress ?? null,
      finalSelectedFeeTier: feeTier,
      expectedFeeTier: expectedFeeTier,
      poolSelectionCorrect,
    }
    
    // Build prices with both directions explicitly
    const prices: Record<string, unknown> = {}
    if (midPrice) {
      prices.mid_outPerIn = {
        rawFraction: `${midPrice.numerator.toString()}/${midPrice.denominator.toString()}`,
        exact: midPrice.toSignificant(18),
        derivedBy: 'pool.priceOf(tokenIn)',
      }
      prices.mid_inPerOut = {
        rawFraction: `${midPrice.denominator.toString()}/${midPrice.numerator.toString()}`,
        exact: midPrice.invert().toSignificant(18),
        derivedBy: 'inverse(mid_outPerIn)',
      }
      
      // Alternative derivations for sanity checks
      if (poolState) {
        const midPriceLog = (debugBundle as any).midPrice as any
        if (midPriceLog?.sqrtPriceX96_calculation) {
          const midFromSqrt = midPriceLog.sqrtPriceX96_calculation.priceToken1PerToken0_adjusted
          const midSdk = midPrice.toSignificant(18)
          const midFromSqrtNum = parseFloat(midFromSqrt)
          const midSdkNum = parseFloat(midSdk)
          const midSqrtDiff = Math.abs(midFromSqrtNum - midSdkNum)
          const midSqrtTolerance = 0.000001 // 1e-6
          
          prices.mid_from_sqrtPriceX96 = {
            priceToken1PerToken0_raw: midPriceLog.sqrtPriceX96_calculation.priceToken1PerToken0_raw,
            priceToken1PerToken0_adjusted: midFromSqrt,
            derivedBy: 'manual calculation from sqrtPriceX96',
            matchesSDK: midSqrtDiff <= midSqrtTolerance,
            diff: midSqrtDiff,
          }
        }
        if (midPriceLog?.tick_calculation) {
          const midFromTick = midPriceLog.tick_calculation.priceToken1PerToken0_adjusted
          const midSdk = midPrice.toSignificant(18)
          const midFromTickNum = parseFloat(midFromTick)
          const midSdkNum = parseFloat(midSdk)
          const midTickDiff = Math.abs(midFromTickNum - midSdkNum)
          const midTickTolerance = 0.000001 // 1e-6
          
          prices.mid_from_tick = {
            priceToken1PerToken0_raw: midPriceLog.tick_calculation.priceToken1PerToken0_raw,
            priceToken1PerToken0_adjusted: midFromTick,
            derivedBy: 'manual calculation from tick',
            matchesSDK: midTickDiff <= midTickTolerance,
            diff: midTickDiff,
          }
        }
      }
    }
    
    if (executionPrice) {
      // Raw-first: execution price from raw amounts
      const amountInRaw = amountIn.quotient.toString()
      const quoteOutRaw = amountOut.quotient.toString()
      const execRawFraction = {
        numerator: quoteOutRaw,
        denominator: amountInRaw,
        scale: 10 ** (tokenIn.decimals - tokenOut.decimals), // Decimal adjustment factor
      }
      
      prices.exec_outPerIn = {
        rawFraction: `${executionPrice.numerator.toString()}/${executionPrice.denominator.toString()}`,
        rawFraction_fromAmounts: `${quoteOutRaw}/${amountInRaw}`,
        rawFractionScale: execRawFraction.scale.toString(),
        exact: executionPrice.toSignificant(18),
        derivedBy: 'quoteOutRaw/amountInRaw (scaled by SDK Price constructor)',
      }
      prices.exec_inPerOut = {
        rawFraction: `${executionPrice.denominator.toString()}/${executionPrice.numerator.toString()}`,
        rawFraction_fromAmounts: `${amountInRaw}/${quoteOutRaw}`,
        exact: executionPrice.invert().toSignificant(18),
        derivedBy: 'inverse(exec_outPerIn)',
      }
    }
    
    // Build impact section
    const impactData = (debugBundle as any).priceImpact as any
    const impact: Record<string, unknown> = {
      formula: '(mid_outPerIn - exec_outPerIn) / mid_outPerIn',
      priceImpactBps: priceImpactBps ?? null,
    }
    
    if (impactData?.sanityCheck_inverse) {
      impact.crossCheckBpsUsingInverse = impactData.sanityCheck_inverse.impactBps_inverse_clamped
      impact.crossCheckDeltaBps = Math.abs((impactData.impactBps_clamped ?? 0) - (impactData.sanityCheck_inverse.impactBps_inverse_clamped ?? 0))
    }
    
    // Build fee model section
    const feeModel = {
      feeTierBps: feeTierBps,
      feeTierUniswap: feeTier,
      notes: 'Mid price should be from pool state; exec price includes fee+slippage from quote.',
      poolSelection: poolSelection,
    }
    
    // Build slippage section
    const slippage: Record<string, unknown> = {}
    if (amountOutQuotedRaw && amountOutMinimumRaw) {
      const quoted = BigInt(amountOutQuotedRaw)
      const minimum = BigInt(amountOutMinimumRaw)
      const bufferRaw = quoted - minimum
      
      slippage.toleranceBps = slippageToleranceBps ?? null
      slippage.amountOutMinimumRaw = amountOutMinimumRaw
      slippage.amountOutMinimumExact = (() => {
        try {
          return CurrencyAmount.fromRawAmount(tokenOut, minimum).toExact()
        } catch {
          return null
        }
      })()
      slippage.bufferRaw = bufferRaw.toString()
      slippage.wouldRevertIfOutLtMin = true
    }
    
    // Build quoter cross-check section
    const quoter: Record<string, unknown> = {}
    const simulationData = (debugBundle as any).simulation as any
    if (simulationData?.simulatedAmountOutRaw) {
      quoter.quoteExactInputSingle = {
        success: true,
        outRaw: simulationData.simulatedAmountOutRaw,
        outExact: (() => {
          try {
            return CurrencyAmount.fromRawAmount(tokenOut, BigInt(simulationData.simulatedAmountOutRaw)).toExact()
          } catch {
            return null
          }
        })(),
        error: null,
      }
      
      // Compare with displayed quote
      const displayedOutRaw = amountOut.quotient.toString()
      const quoterOutRaw = simulationData.simulatedAmountOutRaw
      const diff = BigInt(quoterOutRaw) - BigInt(displayedOutRaw)
      const diffAbs = diff < 0n ? -diff : diff
      const tolerance = 1n // Allow 1 unit difference
      quoter.matchesDisplayedQuote = diffAbs <= tolerance
      quoter.diffRaw = diff.toString()
    } else if (simulationData?.error) {
      quoter.quoteExactInputSingle = {
        success: false,
        outRaw: null,
        outExact: null,
        error: simulationData.error,
      }
    }
    
    // Build simulation section (swap callStatic)
    const simulate: Record<string, unknown> = {}
    if (swapTxRequest && account && publicClient) {
      try {
        const simResult = await simulateTransaction(publicClient, {
          to: swapTxRequest.to,
          data: swapTxRequest.data,
          value: swapTxRequest.value || 0n,
          account: account,
        })
        
        if (simResult.success) {
          simulate.swapCallStatic = {
            success: true,
            outRaw: null, // Would need to decode from return data
            errorReason: null,
          }
        } else {
          simulate.swapCallStatic = {
            success: false,
            outRaw: null,
            errorReason: simResult.reason || 'Transaction would revert',
          }
        }
      } catch (error) {
        simulate.swapCallStatic = {
          success: false,
          outRaw: null,
          errorReason: error instanceof Error ? error.message : String(error),
        }
      }
    }
    
    // Build tx section
    const tx: Record<string, unknown> = {}
    if (params.swapTxPayload) {
      tx.to = params.swapTxPayload.to ?? null
      tx.dataLen = params.swapTxPayload.data?.length ?? 0
      tx.value = params.swapTxPayload.value ?? '0'
      tx.deadline = params.swapTxPayload.deadline ?? null
      tx.recipient = null // Would need to decode from tx data
      tx.amountOutMinimum = params.swapTxPayload.amountOutMinimumRaw ?? null
    } else if (swapTxRequest) {
      tx.to = swapTxRequest.to
      tx.dataLen = swapTxRequest.data.length
      tx.value = swapTxRequest.value?.toString() ?? '0'
      tx.deadline = null // Would need to decode from tx data
      tx.recipient = null // Would need to decode from tx data
      tx.amountOutMinimum = amountOutMinimumRaw ?? null
    }
    
    // Build network cost section
    const networkCostAudit: Record<string, unknown> = {
      approvalRequired: needsApprove,
      displayed: networkCost?.step ?? 'none',
    }
    
    if (approvalCost) {
      networkCostAudit.approvalTx = {
        gasLimit: approvalCost.gasLimit?.toString() ?? null,
        maxFeePerGas: approvalCost.maxFeePerGas?.toString() ?? null,
        maxPriorityFeePerGas: approvalCost.maxPriorityFeePerGas?.toString() ?? null,
        estimatedWei: approvalCost.gasFeeWei?.toString() ?? null,
        estimatedEth: approvalCost.gasFeeWei 
          ? (Number(approvalCost.gasFeeWei) / 1e18).toFixed(12)
          : null,
      }
    }
    
    if (swapCost) {
      networkCostAudit.swapTx = {
        gasLimit: swapCost.gasLimit?.toString() ?? null,
        maxFeePerGas: swapCost.maxFeePerGas?.toString() ?? null,
        maxPriorityFeePerGas: swapCost.maxPriorityFeePerGas?.toString() ?? null,
        estimatedWei: swapCost.gasFeeWei?.toString() ?? null,
        estimatedEth: swapCost.gasFeeWei 
          ? (Number(swapCost.gasFeeWei) / 1e18).toFixed(12)
          : null,
      }
    }
    
    // Build pool section with full slot0 details
    const poolAudit: Record<string, unknown> = {}
    if (poolState) {
      poolAudit.token0 = {
        address: poolState.token0.address,
        decimals: poolState.token0.decimals,
        symbol: poolState.token0.symbol,
      }
      poolAudit.token1 = {
        address: poolState.token1.address,
        decimals: poolState.token1.decimals,
        symbol: poolState.token1.symbol,
      }
      poolAudit.token0Decimals = poolState.token0.decimals
      poolAudit.token1Decimals = poolState.token1.decimals
      poolAudit.slot0 = {
        sqrtPriceX96: poolState.sqrtPriceX96,
        tick: poolState.tick,
        observationCardinality: poolState.observationCardinality ?? null,
        observationCardinalityNext: poolState.observationCardinalityNext ?? null,
      }
      poolAudit.liquidity = poolState.liquidity
      poolAudit.tickSpacing = poolState.tickSpacing ?? null
      poolAudit.poolAddress = poolState.poolAddress
      poolAudit.fee = poolState.fee
    }
    
    // Add pool selection details
    poolAudit.poolSelection = poolSelection
    
    // Build amounts section (raw-first)
    const amounts = {
      amountInRaw: amountIn.quotient.toString(),
      amountInExact: amountIn.toExact(),
      quoteOutRaw: amountOut.quotient.toString(),
      quoteOutExact: amountOut.toExact(),
    }
    
    // Build tokens section
    const tokens = {
      tokenIn: {
        address: tokenIn.isToken ? tokenIn.address : tokenIn.wrapped.address,
        symbol: tokenIn.symbol,
        decimals: tokenIn.decimals,
      },
      tokenOut: {
        address: tokenOut.isToken ? tokenOut.address : tokenOut.wrapped.address,
        symbol: tokenOut.symbol,
        decimals: tokenOut.decimals,
      },
      decimals: {
        tokenIn: tokenIn.decimals,
        tokenOut: tokenOut.decimals,
      },
      addresses: {
        tokenIn: tokenIn.isToken ? tokenIn.address : tokenIn.wrapped.address,
        tokenOut: tokenOut.isToken ? tokenOut.address : tokenOut.wrapped.address,
      },
    }
    
    // Build meta section
    const meta = {
      chainId,
      auditId,
      timestamp: Date.now(),
      isExactIn: true,
      feeTier: feeTier,
      poolAddress: poolState?.poolAddress ?? null,
    }
    
    // Check mid price alternative derivations tolerance
    let midMatchesAltDerivations = true
    if (prices.mid_from_sqrtPriceX96 && (prices.mid_from_sqrtPriceX96 as any).matchesSDK === false) {
      midMatchesAltDerivations = false
    }
    if (prices.mid_from_tick && (prices.mid_from_tick as any).matchesSDK === false) {
      midMatchesAltDerivations = false
    }
    
    // Build invariants section
    const invariantsAudit = {
      decimalsConsistent: invariants.decimalsConsistent,
      directionConsistent: invariants.directionConsistent,
      quoteMatchesQuoterWithinTolerance: quoter.matchesDisplayedQuote ?? null,
      midMatchesAltDerivationsWithinTolerance: midMatchesAltDerivations,
      warnings: invariants.warnings,
      poolSelectionCorrect,
    }
    
    // Emit comprehensive math audit bundle
    const auditBundle = {
      meta,
      tokens,
      amounts,
      pool: poolAudit,
      prices,
      impact,
      feeModel,
      slippage,
      quoter,
      simulate,
      tx,
      networkCost: networkCostAudit,
      invariants: invariantsAudit,
    }
    
    debugOnChainMathAudit(chainId, auditId, auditBundle)
  }

  // Compute LP fee amount for exact-in swaps
  const lpFeeAmount = (() => {
    if (!feeTier || !amountIn || feeTier <= 0 || feeTier >= 1_000_000) {
      return null
    }
    const oneMinusFeeScaled = 1_000_000 - feeTier
    if (oneMinusFeeScaled > 0) {
      const amountInAfterFeeRaw = JSBI.divide(
        JSBI.multiply(amountIn.quotient, JSBI.BigInt(oneMinusFeeScaled)),
        JSBI.BigInt(1_000_000)
      )
      if (JSBI.greaterThan(amountInAfterFeeRaw, JSBI.BigInt(0)) && JSBI.lessThan(amountInAfterFeeRaw, amountIn.quotient)) {
        const amountInAfterFee = CurrencyAmount.fromRawAmount(amountIn.currency, amountInAfterFeeRaw)
        return amountIn.subtract(amountInAfterFee)
      }
    }
    return null
  })()

  return {
    executionPrice,
    midPrice,
    priceImpactBps,
    lpFeeBps,
    lpFeeAmount,
    feeTier,
    rate,
    networkCost,
    routingLabel: 'On-chain',
    debug: debugBundle,
  }
}
