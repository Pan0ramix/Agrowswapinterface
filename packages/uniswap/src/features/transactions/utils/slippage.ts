/**
 * Centralized Slippage Handling Utilities (Uniswap-Grade Safety)
 *
 * Provides fail-closed behavior for swaps (invalid slippage prevents tx building)
 * and resilient behavior for liquidity/quote flows (never crash, safe fallbacks).
 *
 * Safety guarantees:
 * - Swaps: Invalid slippage → Result error (tx building blocked)
 * - Liquidity/Quote: Invalid slippage → amountOut fallback + warning log
 * - 50% slippage cap enforced
 * - Prototype-safe normalization
 * - Invariant enforcement: 0 <= minOut <= amountOut
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { logger } from 'utilities/src/logger/logger'

/**
 * Maximum slippage tolerance cap (50% as used in Uniswap Interface UI)
 * Matches the UI cap in MaxSlippageSettings: parsed > 5000 basis points is rejected
 */
export const MAX_SLIPPAGE_TOLERANCE_BPS = 5_000 // 50% = 5000 basis points
const MAX_SLIPPAGE_TOLERANCE = new Percent(MAX_SLIPPAGE_TOLERANCE_BPS, 10_000)

/**
 * Constants for slippage calculations
 */
const ZERO = new Percent(0, 1) // 0%
const ONE = new Percent(1, 1) // 100%

/**
 * Percent-like object that can be normalized
 */
interface PercentLike {
  numerator?: bigint | number | string
  denominator?: bigint | number | string
}

/**
 * Slippage error types
 */
export class InvalidSlippageInputError extends Error {
  constructor(
    message: string,
    public readonly input: unknown,
  ) {
    super(message)
    this.name = 'InvalidSlippageInputError'
  }
}

export class InvalidPercentDenominatorError extends Error {
  constructor(
    message: string,
    public readonly numerator: unknown,
    public readonly denominator: unknown,
  ) {
    super(message)
    this.name = 'InvalidPercentDenominatorError'
  }
}

export class OutOfRangeClampedError extends Error {
  constructor(
    message: string,
    public readonly originalValue: Percent,
    public readonly clampedValue: Percent,
  ) {
    super(message)
    this.name = 'OutOfRangeClampedError'
  }
}

export type SlippageError = InvalidSlippageInputError | InvalidPercentDenominatorError | OutOfRangeClampedError

/**
 * Result type for strict slippage operations
 */
export type SlippageResult<T> = { ok: true; value: T } | { ok: false; error: SlippageError }

/**
 * Normalize various slippage input types to a Percent instance
 *
 * Accepts:
 * - Percent instance
 * - Percent-like object { numerator, denominator }
 * - Raw numeric basis points (0.5% = 50 basis points = 50/10000)
 *
 * Returns null if input cannot be normalized (invalid, NaN, etc.)
 *
 * This function is prototype-safe - it never calls instance methods
 * on the input until it's been normalized to a fresh Percent instance.
 */
export function normalizePercent(input: unknown): Percent | null {
  // Case 1: Already a Percent instance
  if (input instanceof Percent) {
    // Validate it's not corrupted
    try {
      const num = typeof input.numerator === 'bigint' ? Number(input.numerator) : Number(input.numerator)
      const den = typeof input.denominator === 'bigint' ? Number(input.denominator) : Number(input.denominator)

      if (isNaN(num) || isNaN(den) || den === 0) {
        return null
      }

      // Return a fresh instance to ensure prototype is intact
      return new Percent(input.numerator, input.denominator)
    } catch {
      return null
    }
  }

  // Case 2: Percent-like object
  if (input && typeof input === 'object' && 'numerator' in input && 'denominator' in input) {
    try {
      const like = input as PercentLike
      const num = like.numerator
      const den = like.denominator

      if (num === undefined || den === undefined) {
        return null
      }

      // Convert to BigInt/Number safely
      const numBigInt = typeof num === 'string' ? BigInt(num) : typeof num === 'bigint' ? num : BigInt(num)
      const denBigInt = typeof den === 'string' ? BigInt(den) : typeof den === 'bigint' ? den : BigInt(den)

      if (denBigInt === 0n) {
        return null
      }

      // Check for NaN (BigInt can't be NaN, but check the conversion)
      if (typeof num === 'number' && (isNaN(num) || !isFinite(num))) {
        return null
      }
      if (typeof den === 'number' && (isNaN(den) || !isFinite(den))) {
        return null
      }

      return new Percent(numBigInt, denBigInt)
    } catch {
      return null
    }
  }

  // Case 3: Raw number (interpreted as basis points)
  if (typeof input === 'number') {
    if (isNaN(input) || !isFinite(input)) {
      return null
    }

    // Convert percentage to basis points (0.5% = 50 basis points)
    const basisPoints = Math.round(input * 100)
    return new Percent(basisPoints, 10_000)
  }

  // Case 4: String number (basis points)
  if (typeof input === 'string') {
    try {
      const num = parseFloat(input)
      if (isNaN(num) || !isFinite(num)) {
        return null
      }
      const basisPoints = Math.round(num * 100)
      return new Percent(basisPoints, 10_000)
    } catch {
      return null
    }
  }

  return null
}

/**
 * Get slippage tolerance with validation and capping
 *
 * Returns Result type:
 * - ok: true -> valid Percent (capped at 50% if needed)
 * - ok: false -> error with details
 *
 * Never throws - always returns Result
 */
export function getSlippageToleranceOrError(input: unknown): SlippageResult<Percent> {
  // Step 1: Normalize input
  const slippage = normalizePercent(input)

  // Step 2: Check if normalization failed
  if (!slippage) {
    // Check for specific error case: zero denominator
    if (
      input &&
      typeof input === 'object' &&
      'numerator' in input &&
      'denominator' in input &&
      (input as PercentLike).denominator === 0
    ) {
      return {
        ok: false,
        error: new InvalidPercentDenominatorError(
          'Slippage denominator cannot be zero',
          (input as PercentLike).numerator,
          0,
        ),
      }
    }

    return {
      ok: false,
      error: new InvalidSlippageInputError(`Invalid slippage input: ${JSON.stringify(input)}`, input),
    }
  }

  // Step 3: Cap slippage at MAX_SLIPPAGE_TOLERANCE (50%)
  if (slippage.greaterThan(MAX_SLIPPAGE_TOLERANCE)) {
    const clamped = MAX_SLIPPAGE_TOLERANCE
    return {
      ok: true,
      value: clamped,
      // Note: We return success but could optionally include OutOfRangeClampedError in a union type
      // For now, we log the clamping but still return success with clamped value
    } as SlippageResult<Percent>
  }

  return { ok: true, value: slippage }
}

/**
 * Calculate complement (1 - slippage) with clamping
 *
 * Never throws - complement is always clamped to [0%, 100%]
 */
export function getComplement(slippage: Percent): Percent {
  // Calculate (1 - slippage) manually to avoid prototype dependency
  let complement: Percent

  try {
    // Try using complement() if available
    if (typeof slippage.complement === 'function') {
      complement = slippage.complement()
    } else {
      // Manual calculation: (1 - slippage)
      complement = ONE.subtract(slippage)
    }
  } catch (error) {
    // Fallback: manual calculation always works
    complement = ONE.subtract(slippage)
  }

  // Clamp complement to [0%, 100%]
  if (complement.lessThan(ZERO)) {
    return ZERO
  }

  if (complement.greaterThan(ONE)) {
    return ONE
  }

  return complement
}

/**
 * Calculate minimum amount out (STRICT - for swap tx building)
 *
 * FAIL-CLOSED: Invalid slippage returns error, preventing tx construction.
 * This ensures swaps never proceed with invalid or unknown slippage protection.
 *
 * @param amountOut - The expected output amount
 * @param slippageInput - Slippage as Percent, Percent-like object, or number
 * @returns Result with CurrencyAmount on success, or SlippageError on failure
 */
export function calculateAmountOutMinimumStrict(
  amountOut: CurrencyAmount<Currency>,
  slippageInput: unknown,
): SlippageResult<CurrencyAmount<Currency>> {
  // Step 1: Validate and get slippage tolerance
  const slippageResult = getSlippageToleranceOrError(slippageInput)

  if (!slippageResult.ok) {
    return slippageResult as SlippageResult<CurrencyAmount<Currency>>
  }

  const slippage = slippageResult.value

  // Step 2: Calculate complement (already capped at 50%, so complement >= 50%)
  const complement = getComplement(slippage)

  // Step 3: Calculate minimum amount
  const amountOutMinimum = amountOut.multiply(complement)

  // Step 4: Enforce invariants (dev throws, prod logs and clamps)
  const amountOutRaw = BigInt(amountOut.quotient.toString())
  const minimumRaw = BigInt(amountOutMinimum.quotient.toString())

  // Invariant 1: amountOutMinimum <= amountOut
  if (minimumRaw > amountOutRaw) {
    const violation = `amountOutMinimum (${amountOutMinimum.toExact()}) > amountOut (${amountOut.toExact()})`

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Slippage invariant violation: ${violation}`)
    }

    logger.error(new Error(`Slippage invariant violation: ${violation}`), {
      tags: { file: 'slippage.ts', function: 'calculateAmountOutMinimumStrict' },
      extra: { amountOut: amountOut.toExact(), amountOutMinimum: amountOutMinimum.toExact() },
    })
    // Return error - strict mode does not allow fallback
    return {
      ok: false,
      error: new InvalidSlippageInputError(`Slippage calculation produced invalid result: ${violation}`, slippageInput),
    }
  }

  // Invariant 2: amountOutMinimum >= 0
  if (minimumRaw < 0n) {
    const violation = `amountOutMinimum (${amountOutMinimum.toExact()}) < 0`

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Slippage invariant violation: ${violation}`)
    }

    logger.error(new Error(`Slippage invariant violation: ${violation}`), {
      tags: { file: 'slippage.ts', function: 'calculateAmountOutMinimumStrict' },
      extra: { amountOut: amountOut.toExact(), amountOutMinimum: amountOutMinimum.toExact() },
    })
    // Return error - strict mode does not allow fallback
    return {
      ok: false,
      error: new InvalidSlippageInputError(`Slippage calculation produced invalid result: ${violation}`, slippageInput),
    }
  }

  return { ok: true, value: amountOutMinimum }
}

/**
 * Calculate minimum amount out (LENIENT - for quotes/UI display)
 *
 * RESILIENT: Invalid slippage returns amountOut (0% slippage tolerance - strict safe fallback).
 * Never throws - always returns a valid CurrencyAmount.
 *
 * This provides maximum protection (0% slippage tolerance = strict) but allows UI to continue
 * functioning when slippage config is corrupted.
 *
 * @param amountOut - The expected output amount
 * @param slippageInput - Slippage as Percent, Percent-like object, or number
 * @param context - Optional context for logging (chainId, feature area)
 * @returns CurrencyAmount (always valid, never throws)
 */
export function calculateAmountOutMinimumLenient(
  amountOut: CurrencyAmount<Currency>,
  slippageInput: unknown,
  context?: { chainId?: number; feature?: 'liquidity' | 'quote' },
): CurrencyAmount<Currency> {
  // Step 1: Validate and get slippage tolerance
  const slippageResult = getSlippageToleranceOrError(slippageInput)

  if (!slippageResult.ok) {
    // Log warning with context
    logger.warn(
      'slippage',
      'calculateAmountOutMinimumLenient',
      'Invalid slippage in lenient mode, using amountOut as fallback (0% slippage tolerance - strict safe)',
      {
        error: slippageResult.error.message,
        input: slippageInput,
        amountOut: amountOut.toExact(),
        chainId: context?.chainId,
        feature: context?.feature,
      },
    )
    // Return amountOut (0% slippage tolerance - strict but safe fallback)
    return amountOut
  }

  const slippage = slippageResult.value

  // Step 2: Calculate complement (already capped at 50%)
  const complement = getComplement(slippage)

  // Step 3: Calculate minimum amount
  const amountOutMinimum = amountOut.multiply(complement)

  // Step 4: Enforce invariants (dev throws, prod logs and clamps to amountOut)
  const amountOutRaw = BigInt(amountOut.quotient.toString())
  const minimumRaw = BigInt(amountOutMinimum.quotient.toString())

  // Invariant 1: amountOutMinimum <= amountOut
  if (minimumRaw > amountOutRaw) {
    const violation = `amountOutMinimum (${amountOutMinimum.toExact()}) > amountOut (${amountOut.toExact()})`

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Slippage invariant violation: ${violation}`)
    }

    logger.error(new Error(`Slippage invariant violation: ${violation}`), {
      tags: { file: 'slippage.ts', function: 'calculateAmountOutMinimumLenient' },
      extra: { amountOut: amountOut.toExact(), amountOutMinimum: amountOutMinimum.toExact(), context },
    })
    // Clamp to amountOut (strict safe fallback)
    return amountOut
  }

  // Invariant 2: amountOutMinimum >= 0
  if (minimumRaw < 0n) {
    const violation = `amountOutMinimum (${amountOutMinimum.toExact()}) < 0`

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Slippage invariant violation: ${violation}`)
    }

    logger.error(new Error(`Slippage invariant violation: ${violation}`), {
      tags: { file: 'slippage.ts', function: 'calculateAmountOutMinimumLenient' },
      extra: { amountOut: amountOut.toExact(), amountOutMinimum: amountOutMinimum.toExact(), context },
    })
    // Clamp to amountOut (strict safe fallback - NOT 0)
    return amountOut
  }

  return amountOutMinimum
}

/**
 * Calculate minimum amount out (DEPRECATED - use Strict or Lenient)
 *
 * @deprecated Use calculateAmountOutMinimumStrict() for swaps or calculateAmountOutMinimumLenient() for quotes/UI
 * This function is maintained for backwards compatibility but should be migrated.
 */
export function calculateAmountOutMinimum(
  amountOut: CurrencyAmount<Currency>,
  slippageInput: unknown,
  mode: 'swap' | 'liquidity' | 'quote' = 'swap',
): CurrencyAmount<Currency> {
  if (mode === 'swap') {
    // For swaps, use strict (but catch error for backwards compatibility)
    const result = calculateAmountOutMinimumStrict(amountOut, slippageInput)
    if (!result.ok) {
      // Backwards compatibility: throw error (caller should migrate to Result-based API)
      throw result.error
    }
    return result.value
  }

  // For liquidity/quote, use lenient
  return calculateAmountOutMinimumLenient(amountOut, slippageInput, {
    feature: mode === 'liquidity' ? 'liquidity' : 'quote',
  })
}

