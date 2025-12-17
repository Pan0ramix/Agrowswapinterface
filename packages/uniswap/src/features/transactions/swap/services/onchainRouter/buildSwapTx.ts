/**
 * Swap Transaction Builder
 *
 * Builds swap transaction payloads with proper path encoding for single and multi-hop swaps.
 * Uses Uniswap's exact path encoding format: address | fee | address | fee | address
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { Interface } from 'ethers/lib/utils'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { getSwapRouterAddress } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { ValidatedRoute } from 'uniswap/src/features/transactions/swap/services/onchainRouter/validateRouteWithQuoter'
import { logger } from 'utilities/src/logger/logger'

/**
 * Transaction payload for swap
 */
export interface SwapTransactionPayload {
  to: string
  data: string
  value: string // '0x0' for ERC20 swaps, or amount in wei for native token swaps
  gasLimit?: string
}

/**
 * Parameters for building swap transaction
 */
export interface BuildSwapTxParams {
  route: ValidatedRoute
  amountIn: CurrencyAmount<Currency>
  minAmountOut?: CurrencyAmount<Currency> // After slippage (for exact input)
  maxAmountIn?: CurrencyAmount<Currency> // Maximum input with slippage (for exact output)
  chainId: EVMUniverseChainId
  recipient: string
  deadline: number // Unix timestamp in seconds
  sqrtPriceLimitX96?: string // Optional price limit (0 = no limit)
}

/**
 * Get SwapRouter contract address
 */
function getSwapRouterContractAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap address first for Base Sepolia
  if (chainId === 84532) {
    return getAgroswapSwapRouterAddress(chainId)
  }

  // Try v3Addresses override
  const v3Address = getSwapRouterAddress(chainId)
  if (v3Address) {
    return v3Address
  }

  throw new Error(`SwapRouter address not found for chain ${chainId}`)
}

/**
 * SwapRouter ABI for exactInputSingle and exactInput
 */
const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter02.ExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'path', type: 'bytes' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
        ],
        internalType: 'struct ISwapRouter02.ExactInputParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInput',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
          { internalType: 'uint256', name: 'amountInMaximum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter02.ExactOutputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactOutputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountIn', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

/**
 * Encode path for multi-hop swap
 * Format: address (20 bytes) | fee (3 bytes) | address (20 bytes) | fee (3 bytes) | address (20 bytes)
 *
 * Example for 2 hops:
 * token0 (20 bytes) | fee0 (3 bytes) | token1 (20 bytes) | fee1 (3 bytes) | token2 (20 bytes)
 */
function encodePath(hops: ValidatedRoute['route']['hops']): `0x${string}` {
  let path = '0x'

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]

    // Add tokenIn address (20 bytes = 40 hex chars)
    // Remove '0x' prefix and pad to 40 characters
    const address = hop.tokenIn.address.slice(2).toLowerCase().padStart(40, '0')
    path += address

    // Add fee (3 bytes = 6 hex chars)
    const feeHex = hop.fee.toString(16).padStart(6, '0')
    path += feeHex

    // Add last tokenOut address
    if (i === hops.length - 1) {
      const lastAddress = hop.tokenOut.address.slice(2).toLowerCase().padStart(40, '0')
      path += lastAddress
    }
  }

  return path as `0x${string}`
}

/**
 * Error codes for transaction building failures
 */
export enum BuildSwapTxErrorCode {
  INVALID_SLIPPAGE = 'INVALID_SLIPPAGE',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND',
  TX_BUILD_INVARIANT = 'TX_BUILD_INVARIANT',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Unified error type for transaction building failures
 */
export interface BuildSwapTxError {
  code: BuildSwapTxErrorCode
  message: string
  details?: unknown
}

/**
 * Legacy error class (preserved for backwards compatibility)
 * @deprecated Use BuildSwapTxError type instead
 */
export class InvalidSlippageTxBuildError extends Error {
  constructor(
    message: string,
    public readonly slippageError: unknown,
  ) {
    super(message)
    this.name = 'InvalidSlippageTxBuildError'
  }
}

/**
 * Helper to create BuildSwapTxError from error code
 */
function createBuildSwapTxError(code: BuildSwapTxErrorCode, message: string, details?: unknown): BuildSwapTxError {
  return { code, message, details }
}

/**
 * Result type for tx builder
 */
export type BuildSwapTxResult = { ok: true; value: SwapTransactionPayload } | { ok: false; error: BuildSwapTxError }

/**
 * Build swap transaction payload (STRICT - enforces slippage validation and invariants)
 *
 * FAIL-CLOSED: Validates minAmountOut/maxAmountIn using strict slippage calculation and enforces invariants.
 * If slippage is invalid or invariants fail, returns error - swap tx cannot be built.
 *
 * Invariants enforced:
 * - minAmountOut >= 0 (for exact input)
 * - minAmountOut <= expectedAmountOut (for exact input)
 * - maxAmountIn >= 0 (for exact output)
 * - maxAmountIn >= expectedAmountIn (for exact output)
 * - Currency consistency: minOut currency matches output, maxIn currency matches input
 *
 * @param params - Swap parameters (minAmountOut should be validated via calculateAmountOutMinimumStrict)
 * @returns Result with transaction payload on success, or error on failure
 */
export function buildSwapTxStrict(params: BuildSwapTxParams): BuildSwapTxResult {
  const { route, amountIn, minAmountOut, maxAmountIn } = params
  const isExactOut = !!maxAmountIn && !minAmountOut

  // Invariant 1: Validate minAmountOut (for exact input)
  if (minAmountOut) {
    try {
      const minOutQuotient = BigInt(minAmountOut.quotient.toString())
      const expectedAmountOut = route.amountOutCurrency ? BigInt(route.amountOutCurrency.quotient.toString()) : null

      // Invariant 1a: minAmountOut >= 0
      if (minOutQuotient < 0n) {
        return {
          ok: false,
          error: createBuildSwapTxError(BuildSwapTxErrorCode.TX_BUILD_INVARIANT, 'minAmountOut cannot be negative', {
            minAmountOut: minAmountOut.toExact(),
            quotient: minOutQuotient.toString(),
          }),
        }
      }

      // Invariant 1b: minAmountOut <= expectedAmountOut
      if (expectedAmountOut !== null && minOutQuotient > expectedAmountOut) {
        return {
          ok: false,
          error: createBuildSwapTxError(
            BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
            `minAmountOut (${minAmountOut.toExact()}) cannot exceed expected amountOut (${route.amountOutCurrency?.toExact()})`,
            {
              minAmountOut: minAmountOut.toExact(),
              expectedAmountOut: route.amountOutCurrency?.toExact(),
            },
          ),
        }
      }

      // Invariant 1c: Currency consistency - minOut currency must match output currency
      if (route.amountOutCurrency && minAmountOut.currency.address !== route.amountOutCurrency.currency.address) {
        return {
          ok: false,
          error: createBuildSwapTxError(
            BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
            `minAmountOut currency (${minAmountOut.currency.symbol}) does not match output currency (${route.amountOutCurrency.currency.symbol})`,
            {
              minOutCurrency: minAmountOut.currency.symbol,
              outputCurrency: route.amountOutCurrency.currency.symbol,
            },
          ),
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: createBuildSwapTxError(
          BuildSwapTxErrorCode.INVALID_AMOUNT,
          `Invalid minAmountOut: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      }
    }
  }

  // Invariant 2: Validate maxAmountIn (for exact output)
  if (maxAmountIn) {
    try {
      const maxInQuotient = BigInt(maxAmountIn.quotient.toString())
      const expectedAmountIn = BigInt(amountIn.quotient.toString())

      // Invariant 2a: maxAmountIn >= 0
      if (maxInQuotient < 0n) {
        return {
          ok: false,
          error: createBuildSwapTxError(BuildSwapTxErrorCode.TX_BUILD_INVARIANT, 'maxAmountIn cannot be negative', {
            maxAmountIn: maxAmountIn.toExact(),
            quotient: maxInQuotient.toString(),
          }),
        }
      }

      // Invariant 2b: maxAmountIn >= expectedAmountIn (for exact output, maxIn should allow more than expected)
      // Actually, for exact output, maxAmountIn should be >= amountIn (we allow more input)
      // But we should check it's reasonable - typically maxIn = amountIn * (1 + slippage)
      // This invariant ensures maxAmountIn is at least as large as the expected input
      if (maxInQuotient < expectedAmountIn) {
        return {
          ok: false,
          error: createBuildSwapTxError(
            BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
            `maxAmountIn (${maxAmountIn.toExact()}) must be at least expected amountIn (${amountIn.toExact()})`,
            {
              maxAmountIn: maxAmountIn.toExact(),
              expectedAmountIn: amountIn.toExact(),
            },
          ),
        }
      }

      // Invariant 2c: Currency consistency - maxIn currency must match input currency
      if (maxAmountIn.currency.address !== amountIn.currency.address) {
        return {
          ok: false,
          error: createBuildSwapTxError(
            BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
            `maxAmountIn currency (${maxAmountIn.currency.symbol}) does not match input currency (${amountIn.currency.symbol})`,
            {
              maxInCurrency: maxAmountIn.currency.symbol,
              inputCurrency: amountIn.currency.symbol,
            },
          ),
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: createBuildSwapTxError(
          BuildSwapTxErrorCode.INVALID_AMOUNT,
          `Invalid maxAmountIn: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      }
    }
  }

  // Build the transaction
  try {
    const payload = buildSwapTx(params)
    return { ok: true, value: payload }
  } catch (error) {
    // If building fails for any reason, return error (fail-closed)
    // Check if it's a route-related error
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('route') || errorMessage.includes('Route')) {
      return {
        ok: false,
        error: createBuildSwapTxError(BuildSwapTxErrorCode.ROUTE_NOT_FOUND, `Route error: ${errorMessage}`, error),
      }
    }
    return {
      ok: false,
      error: createBuildSwapTxError(
        BuildSwapTxErrorCode.UNKNOWN,
        `Failed to build swap transaction: ${errorMessage}`,
        error,
      ),
    }
  }
}

/**
 * Build swap transaction payload (legacy - for backwards compatibility)
 *
 * @deprecated Use buildSwapTxStrict() for fail-closed validation
 * This function is maintained for backwards compatibility.
 *
 * @param params - Swap parameters
 * @returns Transaction payload with to, data, and value
 */
export function buildSwapTx(params: BuildSwapTxParams): SwapTransactionPayload {
  const { route, amountIn, minAmountOut, maxAmountIn, chainId, recipient, deadline, sqrtPriceLimitX96 } = params

  const routerAddress = getSwapRouterContractAddress(chainId)
  const routerInterface = new Interface(SWAP_ROUTER_ABI)

  const isExactOut = !!maxAmountIn && !minAmountOut
  const amountInRaw = amountIn.quotient.toString()
  const amountOutMinimumRaw = minAmountOut?.quotient.toString() || '0'
  const amountInMaximumRaw = maxAmountIn?.quotient.toString() || '0'
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Always log for Base Sepolia
  if (chainId === 84532) {
    console.log('[BUILD-SWAP-TX] Building swap tx', {
      chainId,
      isExactOut,
      hasMaxAmountIn: !!maxAmountIn,
      hasMinAmountOut: !!minAmountOut,
      maxAmountInRaw: amountInMaximumRaw,
      minAmountOutRaw: amountOutMinimumRaw,
      amountInRaw,
      hopsCount: route.route.hops.length,
    })
  }

  if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const deadlineSeconds = typeof deadline === 'bigint' ? Number(deadline) : deadline
    logger.debug('buildSwapTx', 'buildSwapTx', 'Building swap tx payload', {
      chainId,
      routerAddress,
      hops: (route.route.hops ?? []).map((h) => ({
        tokenIn: h.tokenIn.symbol,
        tokenOut: h.tokenOut.symbol,
        fee: h.fee,
      })),
      amountInRaw,
      amountOutMinimumRaw,
      amountInMaximumRaw,
      isExactOut,
      recipient,
      deadline: deadlineSeconds,
      nowSeconds,
      deadlineAgeSeconds: deadlineSeconds - nowSeconds,
      priceLimit,
      gasEstimate: route.gasEstimate,
    })
  }

  // Single hop swap
  if (route.route.hops.length === 1) {
    const hop = route.route.hops[0]

    if (isExactOut && maxAmountIn) {
      // Exact output: use exactOutputSingle
      const amountOutRaw = route.amountOutCurrency?.quotient.toString() || '0'

      if (chainId === 84532) {
        console.log('[BUILD-SWAP-TX] Building exactOutputSingle', {
          chainId,
          amountOutRaw,
          amountInMaximumRaw,
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
          fee: hop.fee,
        })
      }

      const data = routerInterface.encodeFunctionData('exactOutputSingle', [
        {
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
          fee: hop.fee,
          recipient,
          deadline,
          amountOut: amountOutRaw,
          amountInMaximum: amountInMaximumRaw,
          sqrtPriceLimitX96: priceLimit,
        },
      ])

      const result = {
        to: routerAddress,
        data,
        value: hop.tokenIn.isNative ? amountInRaw : '0x0',
      }

      if (chainId === 84532) {
        console.log('[BUILD-SWAP-TX] exactOutputSingle result', {
          chainId,
          to: result.to,
          dataLen: result.data.length,
          value: result.value,
        })
      }

      return result
    } else {
      // Exact input: use exactInputSingle
      const data = routerInterface.encodeFunctionData('exactInputSingle', [
        {
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
          fee: hop.fee,
          recipient,
          deadline,
          amountIn: amountInRaw,
          amountOutMinimum: amountOutMinimumRaw,
          sqrtPriceLimitX96: priceLimit,
        },
      ])

      // Determine value (native token amount if tokenIn is native)
      const value = amountIn.currency.isNative ? amountIn.quotient.toString() : '0'

      return {
        to: routerAddress,
        data,
        value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
        gasLimit: route.gasEstimate,
      }
    }
  }

  // Multi-hop swap
  const path = encodePath(route.route.hops)

  const data = routerInterface.encodeFunctionData('exactInput', [
    {
      path,
      recipient,
      deadline,
      amountIn: amountInRaw,
      amountOutMinimum: amountOutMinimumRaw,
    },
  ])

  // Determine value (native token amount if first tokenIn is native)
  const firstTokenIn = route.route.hops[0].tokenIn
  const value = amountIn.currency.isNative ? amountIn.quotient.toString() : '0'

  return {
    to: routerAddress,
    data,
    value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
    gasLimit: route.gasEstimate,
  }
}

/**
 * Calculate minimum amount out with slippage tolerance
 *
 * Delegates to centralized slippage utility with strict mode (fail closed on invalid slippage).
 *
 * @deprecated Import calculateAmountOutMinimumStrict directly from 'uniswap/src/features/transactions/utils/slippage'
 * This wrapper is maintained for backwards compatibility but will throw on invalid slippage.
 */
export function calculateAmountOutMinimum(
  amountOut: CurrencyAmount<Currency>,
  slippageTolerance: Percent | { numerator?: bigint | number; denominator?: bigint | number } | number,
): CurrencyAmount<Currency> {
  // Import here to avoid circular dependencies
  const { calculateAmountOutMinimumStrict } = require('uniswap/src/features/transactions/utils/slippage')

  // Delegate to strict utility (fail closed on invalid slippage)
  const result = calculateAmountOutMinimumStrict(amountOut, slippageTolerance)
  if (!result.ok) {
    throw result.error // Backwards compatibility: throw error
  }
  return result.value
}

/**
 * Get deadline timestamp (current time + TTL seconds)
 * Uniswap-like behavior: deadline is computed fresh at tx build time.
 *
 * @param ttlSeconds - Time-to-live in seconds (default 1200 = 20 minutes)
 * @returns Unix timestamp in seconds (BigInt)
 */
export function getDeadlineSecondsFromNow(ttlSeconds: number = 1200): bigint {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const deadlineSeconds = nowSeconds + ttlSeconds
  return BigInt(deadlineSeconds)
}

/**
 * Get deadline timestamp (current time + minutes)
 * @deprecated Use getDeadlineSecondsFromNow for consistency
 */
export function getDeadline(minutesFromNow: number = 20): number {
  const deadline = getDeadlineSecondsFromNow(minutesFromNow * 60)
  return Number(deadline)
}
