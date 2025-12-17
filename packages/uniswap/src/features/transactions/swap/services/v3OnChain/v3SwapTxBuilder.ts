/**
 * V3 Swap Transaction Builder
 *
 * Builds swap transaction payloads (calldata) for SwapRouter contract calls.
 * This replaces Trading API swap endpoints for building transaction calldata.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { getSwapRouterAddress } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { calculateAmountOutMinimumStrict } from 'uniswap/src/features/transactions/utils/slippage'

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
 * Parameters for building exact input single swap transaction
 */
export interface BuildExactInputSingleSwapParams {
  tokenIn: Currency
  tokenOut: Currency
  fee: FeeAmount
  amountIn: CurrencyAmount<Currency>
  amountOutMinimum: CurrencyAmount<Currency> // After slippage
  recipient: string
  deadline: number // Unix timestamp in seconds
  sqrtPriceLimitX96?: string // Optional price limit (0 = no limit)
  chainId: EVMUniverseChainId
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
 * SwapRouter ABI for exactInputSingle
 * Based on SwapRouter02 from @uniswap/swap-router-contracts
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
]

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
 * Extended parameters for strict validation (includes expected output for invariant checks)
 */
export interface BuildExactInputSingleSwapParamsStrict extends BuildExactInputSingleSwapParams {
  expectedAmountOut?: CurrencyAmount<Currency> // Expected output amount (for invariant validation)
}

/**
 * Build exact input single swap transaction payload (STRICT - enforces slippage validation and invariants)
 *
 * FAIL-CLOSED: Validates amountOutMinimum using strict slippage calculation and enforces invariants.
 * If slippage is invalid or invariants fail, returns error - swap tx cannot be built.
 *
 * Invariants enforced:
 * - amountOutMinimum >= 0
 * - amountOutMinimum <= expectedAmountOut (if provided)
 * - Currency consistency: amountOutMinimum currency matches output currency
 *
 * @param params - Swap parameters (amountOutMinimum should be validated via calculateAmountOutMinimumStrict)
 * @returns Result with transaction payload on success, or error on failure
 */
export function buildExactInputSingleSwapTxStrict(params: BuildExactInputSingleSwapParamsStrict): BuildSwapTxResult {
  const { tokenIn, tokenOut, amountIn, amountOutMinimum, expectedAmountOut } = params

  // Invariant 1: amountOutMinimum >= 0
  try {
    const minOutQuotient = BigInt(amountOutMinimum.quotient.toString())
    if (minOutQuotient < 0n) {
      return {
        ok: false,
        error: createBuildSwapTxError(BuildSwapTxErrorCode.TX_BUILD_INVARIANT, 'amountOutMinimum cannot be negative', {
          amountOutMinimum: amountOutMinimum.toExact(),
          quotient: minOutQuotient.toString(),
        }),
      }
    }

    // Invariant 2: amountOutMinimum <= expectedAmountOut (if provided)
    if (expectedAmountOut) {
      const expectedQuotient = BigInt(expectedAmountOut.quotient.toString())
      if (minOutQuotient > expectedQuotient) {
        return {
          ok: false,
          error: createBuildSwapTxError(
            BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
            `amountOutMinimum (${amountOutMinimum.toExact()}) cannot exceed expected amountOut (${expectedAmountOut.toExact()})`,
            {
              amountOutMinimum: amountOutMinimum.toExact(),
              expectedAmountOut: expectedAmountOut.toExact(),
            },
          ),
        }
      }

      // Invariant 3: Currency consistency - amountOutMinimum currency must match output currency
      if (amountOutMinimum.currency.address !== expectedAmountOut.currency.address) {
        return {
          ok: false,
          error: createBuildSwapTxError(
            BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
            `amountOutMinimum currency (${amountOutMinimum.currency.symbol}) does not match output currency (${expectedAmountOut.currency.symbol})`,
            {
              minOutCurrency: amountOutMinimum.currency.symbol,
              outputCurrency: expectedAmountOut.currency.symbol,
            },
          ),
        }
      }
    }

    // Invariant 4: Currency consistency - amountOutMinimum currency must match tokenOut
    if (amountOutMinimum.currency.address !== tokenOut.wrapped.address) {
      return {
        ok: false,
        error: createBuildSwapTxError(
          BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
          `amountOutMinimum currency (${amountOutMinimum.currency.symbol}) does not match tokenOut (${tokenOut.symbol})`,
          {
            minOutCurrency: amountOutMinimum.currency.symbol,
            tokenOut: tokenOut.symbol,
          },
        ),
      }
    }

    // Invariant 5: Currency consistency - amountIn currency must match tokenIn
    if (amountIn.currency.address !== tokenIn.wrapped.address) {
      return {
        ok: false,
        error: createBuildSwapTxError(
          BuildSwapTxErrorCode.TX_BUILD_INVARIANT,
          `amountIn currency (${amountIn.currency.symbol}) does not match tokenIn (${tokenIn.symbol})`,
          {
            amountInCurrency: amountIn.currency.symbol,
            tokenIn: tokenIn.symbol,
          },
        ),
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: createBuildSwapTxError(
        BuildSwapTxErrorCode.INVALID_AMOUNT,
        `Invalid amountOutMinimum: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
    }
  }

  // Build the transaction
  try {
    const payload = buildExactInputSingleSwapTx(params)
    return { ok: true, value: payload }
  } catch (error) {
    // If building fails, return error (fail-closed)
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
 * Builds exact input single swap transaction payload (legacy - for backwards compatibility)
 *
 * @deprecated Use buildExactInputSingleSwapTxStrict() for fail-closed validation
 * This function is maintained for backwards compatibility.
 *
 * @param params - Swap parameters
 * @returns Transaction payload with to, data, and value
 */
export function buildExactInputSingleSwapTx(params: BuildExactInputSingleSwapParams): SwapTransactionPayload {
  const { tokenIn, tokenOut, fee, amountIn, amountOutMinimum, recipient, deadline, sqrtPriceLimitX96, chainId } = params

  const routerAddress = getSwapRouterContractAddress(chainId)
  const routerInterface = new Interface(SWAP_ROUTER_ABI)

  const tokenInAddress = tokenIn.wrapped.address
  const tokenOutAddress = tokenOut.wrapped.address
  const amountInRaw = amountIn.quotient.toString()
  const amountOutMinimumRaw = amountOutMinimum.quotient.toString()
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Encode function call
  const data = routerInterface.encodeFunctionData('exactInputSingle', [
    {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee,
      recipient,
      deadline,
      amountIn: amountInRaw,
      amountOutMinimum: amountOutMinimumRaw,
      sqrtPriceLimitX96: priceLimit,
    },
  ])

  // Determine value (native token amount if tokenIn is native)
  const value = tokenIn.isNative ? amountIn.quotient.toString() : '0'

  return {
    to: routerAddress,
    data,
    value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
  }
}

/**
 * Calculate minimum amount out with slippage tolerance
 *
 * @deprecated Import calculateAmountOutMinimumStrict directly from 'uniswap/src/features/transactions/utils/slippage'
 * This wrapper maintains backwards compatibility but will throw on invalid slippage (fail-closed behavior).
 */
export function calculateAmountOutMinimum(
  amountOut: CurrencyAmount<Currency>,
  slippageTolerance: Percent,
): CurrencyAmount<Currency> {
  // Delegate to strict utility (fail closed on invalid slippage)
  const result = calculateAmountOutMinimumStrict(amountOut, slippageTolerance)
  if (!result.ok) {
    throw result.error // Backwards compatibility: throw error (caller should migrate to Result-based API)
  }
  return result.value
}

/**
 * Get deadline timestamp (current time + minutes)
 */
export function getDeadline(minutesFromNow: number = 20): number {
  return Math.floor(Date.now() / 1000) + minutesFromNow * 60
}
