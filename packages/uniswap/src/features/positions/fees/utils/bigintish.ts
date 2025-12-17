/**
 * BigInt Utilities for Fee Providers
 *
 * Ensures all raw amounts are converted to bigint before passing to CurrencyAmount.fromRawAmount
 * to prevent "Cannot convert 0 to a BigInt" errors from JSBI.
 */

export type BigintIshSafe = bigint | `0x${string}` | string

/**
 * Convert value to bigint - NEVER accepts number
 *
 * This is critical because CurrencyAmount.fromRawAmount uses JSBI.BigInt() internally,
 * which rejects number values. All raw amounts MUST be bigint or string.
 *
 * @throws Error if value is a number or cannot be converted
 */
export function toBigintIshSafe(x: unknown): bigint {
  if (typeof x === 'bigint') {
    return x
  }

  if (typeof x === 'string') {
    // Reject empty strings (BigInt('') returns 0n, but we want explicit validation)
    if (x === '') {
      throw new Error('Cannot convert empty string to BigInt')
    }
    // Handle hex strings and decimal strings
    try {
      return BigInt(x)
    } catch (error) {
      throw new Error(
        `Cannot convert string "${x}" to BigInt: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // NEVER accept number - this causes "Cannot convert 0 to a BigInt" in JSBI
  throw new Error(`Expected bigint|string for amount, got ${typeof x} (value: ${String(x)})`)
}

/**
 * Safely get zero as bigint (never use number 0)
 */
export function zeroBigInt(): bigint {
  return 0n
}
