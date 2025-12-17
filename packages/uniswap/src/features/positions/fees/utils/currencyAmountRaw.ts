/**
 * CurrencyAmount Raw Input Utilities
 *
 * Ensures all raw amounts are converted to string format before passing to CurrencyAmount.fromRawAmount.
 * JSBI (used internally by CurrencyAmount) can be finicky with bigint values, so we convert to string
 * which is the most reliable format.
 */

import JSBI from 'jsbi'

export type CurrencyAmountRawInput = bigint | string | JSBI

/**
 * Check if a string represents a valid integer (no decimals, no exponent notation)
 */
export function isIntegerString(s: string): boolean {
  // Reject empty strings
  if (s === '' || s.trim() === '') {
    return false
  }

  // Remove optional leading sign
  const trimmed = s.trim().replace(/^[+-]/, '')

  // Check if it's all digits (allows leading zeros like "00" or "01")
  return /^\d+$/.test(trimmed)
}

/**
 * Format an error into a safe string message
 */
export function formatProviderError(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }
  if (typeof e === 'string') {
    return e
  }
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as any).message)
  }
  return String(e)
}

/**
 * Convert value to string format safe for CurrencyAmount.fromRawAmount
 *
 * This is critical because CurrencyAmount.fromRawAmount uses JSBI.BigInt() internally,
 * and JSBI can be finicky with certain bigint values. Converting to string is the most
 * reliable format that JSBI handles consistently.
 *
 * Rules:
 * - bigint → value.toString() (e.g., 0n → "0")
 * - string → validate as integer string, return as-is
 * - JSBI → value.toString() (if JSBI is used in the codebase)
 * - number → REJECT (throw error)
 *
 * @throws Error if value is a number or invalid string
 */
export function toCurrencyAmountRaw(value: unknown): string {
  // Handle bigint
  if (typeof value === 'bigint') {
    return value.toString()
  }

  // Handle JSBI (if used in codebase)
  if (typeof value === 'object' && value !== null && 'constructor' in value) {
    // Check if it's a JSBI instance
    if (value.constructor.name === 'JSBI' || value instanceof JSBI) {
      return value.toString()
    }
  }

  // Handle string
  if (typeof value === 'string') {
    // Reject empty strings
    if (value === '' || value.trim() === '') {
      throw new Error('Cannot convert empty string to CurrencyAmount raw value')
    }

    // Validate it's an integer string (no decimals, no exponent)
    if (!isIntegerString(value)) {
      throw new Error(
        `Invalid integer string for CurrencyAmount raw value: "${value}" (must be integer, no decimals or exponent)`,
      )
    }

    return value
  }

  // REJECT number - this is the root cause of "Cannot convert 0 to a BigInt" errors
  if (typeof value === 'number') {
    throw new Error(
      `Cannot convert number to CurrencyAmount raw value: ${value} (use bigint or string instead, e.g., 0n or "0")`,
    )
  }

  // Reject other types
  throw new Error(
    `Cannot convert value to CurrencyAmount raw value: expected bigint|string|JSBI, got ${typeof value} (value: ${String(value)})`,
  )
}
