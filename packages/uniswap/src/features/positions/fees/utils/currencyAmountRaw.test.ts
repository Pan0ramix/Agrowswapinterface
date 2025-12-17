/**
 * Unit tests for CurrencyAmount raw input utilities
 *
 * Tests to prevent "Cannot convert 0 to a BigInt" errors
 */

import JSBI from 'jsbi'
import {
  formatProviderError,
  isIntegerString,
  toCurrencyAmountRaw,
} from 'uniswap/src/features/positions/fees/utils/currencyAmountRaw'
import { describe, expect, it } from 'vitest'

describe('isIntegerString', () => {
  it('should accept valid integer strings', () => {
    expect(isIntegerString('0')).toBe(true)
    expect(isIntegerString('123')).toBe(true)
    expect(isIntegerString('12345678901234567890')).toBe(true)
    expect(isIntegerString('01')).toBe(true) // Leading zeros allowed
    expect(isIntegerString('00')).toBe(true)
  })

  it('should reject non-integer strings', () => {
    expect(isIntegerString('')).toBe(false)
    expect(isIntegerString('   ')).toBe(false)
    expect(isIntegerString('0.1')).toBe(false)
    expect(isIntegerString('1e10')).toBe(false)
    expect(isIntegerString('1.5')).toBe(false)
    expect(isIntegerString('abc')).toBe(false)
    expect(isIntegerString('0x123')).toBe(false)
  })

  it('should handle strings with signs', () => {
    // Our function strips signs, so these should pass
    // (though CurrencyAmount shouldn't use negative, this tests the logic)
    expect(isIntegerString('+123')).toBe(true)
    expect(isIntegerString('-123')).toBe(true)
  })
})

describe('toCurrencyAmountRaw', () => {
  it('should convert bigint 0n to "0"', () => {
    expect(toCurrencyAmountRaw(0n)).toBe('0')
  })

  it('should convert bigint values to string', () => {
    expect(toCurrencyAmountRaw(1n)).toBe('1')
    expect(toCurrencyAmountRaw(123n)).toBe('123')
    expect(toCurrencyAmountRaw(BigInt('12345678901234567890'))).toBe('12345678901234567890')
  })

  it('should accept valid integer string values', () => {
    expect(toCurrencyAmountRaw('0')).toBe('0')
    expect(toCurrencyAmountRaw('123')).toBe('123')
    expect(toCurrencyAmountRaw('12345678901234567890')).toBe('12345678901234567890')
    expect(toCurrencyAmountRaw('01')).toBe('01') // Leading zeros preserved
  })

  it('should accept JSBI values if available', () => {
    expect(toCurrencyAmountRaw(JSBI.BigInt(0))).toBe('0')
    expect(toCurrencyAmountRaw(JSBI.BigInt(123))).toBe('123')
  })

  it('should REJECT number values (critical: prevents JSBI error)', () => {
    expect(() => toCurrencyAmountRaw(0)).toThrow('Cannot convert number')
    expect(() => toCurrencyAmountRaw(123)).toThrow('Cannot convert number')
    expect(() => toCurrencyAmountRaw(Number.MAX_SAFE_INTEGER)).toThrow('Cannot convert number')
  })

  it('should reject invalid string values', () => {
    expect(() => toCurrencyAmountRaw('')).toThrow('empty string')
    expect(() => toCurrencyAmountRaw('0.1')).toThrow('Invalid integer string')
    expect(() => toCurrencyAmountRaw('1e10')).toThrow('Invalid integer string')
    expect(() => toCurrencyAmountRaw('abc')).toThrow('Invalid integer string')
  })

  it('should reject other types', () => {
    expect(() => toCurrencyAmountRaw(null)).toThrow('expected bigint|string|JSBI')
    expect(() => toCurrencyAmountRaw(undefined)).toThrow('expected bigint|string|JSBI')
    expect(() => toCurrencyAmountRaw({})).toThrow('expected bigint|string|JSBI')
    expect(() => toCurrencyAmountRaw([])).toThrow('expected bigint|string|JSBI')
  })
})

describe('formatProviderError', () => {
  it('should format Error objects', () => {
    const error = new Error('Test error message')
    expect(formatProviderError(error)).toBe('Test error message')
  })

  it('should format string errors', () => {
    expect(formatProviderError('String error')).toBe('String error')
  })

  it('should format objects with message property', () => {
    expect(formatProviderError({ message: 'Object error' })).toBe('Object error')
  })

  it('should format other types', () => {
    expect(formatProviderError(123)).toBe('123')
    expect(formatProviderError(null)).toBe('null')
  })
})
