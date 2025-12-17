/**
 * Unit tests for BigInt utilities
 *
 * Tests to prevent "Cannot convert 0 to a BigInt" errors
 */

import { toBigintIshSafe, zeroBigInt } from 'uniswap/src/features/positions/fees/utils/bigintish'
import { describe, expect, it } from 'vitest'

describe('toBigintIshSafe', () => {
  it('should accept bigint values', () => {
    expect(toBigintIshSafe(0n)).toBe(0n)
    expect(toBigintIshSafe(1n)).toBe(1n)
    expect(toBigintIshSafe(BigInt('12345678901234567890'))).toBe(BigInt('12345678901234567890'))
  })

  it('should accept string values (decimal)', () => {
    expect(toBigintIshSafe('0')).toBe(0n)
    expect(toBigintIshSafe('123')).toBe(123n)
    expect(toBigintIshSafe('12345678901234567890')).toBe(BigInt('12345678901234567890'))
  })

  it('should accept string values (hex)', () => {
    expect(toBigintIshSafe('0x0')).toBe(0n)
    expect(toBigintIshSafe('0xff')).toBe(255n)
    expect(toBigintIshSafe('0x1234')).toBe(0x1234n)
  })

  it('should REJECT number values (critical: prevents JSBI error)', () => {
    expect(() => toBigintIshSafe(0)).toThrow('Expected bigint|string for amount, got number')
    expect(() => toBigintIshSafe(123)).toThrow('Expected bigint|string for amount, got number')
    expect(() => toBigintIshSafe(Number.MAX_SAFE_INTEGER)).toThrow('Expected bigint|string for amount, got number')
  })

  it('should reject invalid string values', () => {
    expect(() => toBigintIshSafe('abc')).toThrow('Cannot convert string')
    // Note: BigInt('') actually returns 0n in JavaScript, so empty string is technically valid
    // but we reject it explicitly for safety
    expect(() => toBigintIshSafe('')).toThrow('Cannot convert empty string')
  })

  it('should reject other types', () => {
    expect(() => toBigintIshSafe(null)).toThrow('Expected bigint|string for amount, got object')
    expect(() => toBigintIshSafe(undefined)).toThrow('Expected bigint|string for amount, got undefined')
    expect(() => toBigintIshSafe({})).toThrow('Expected bigint|string for amount, got object')
    expect(() => toBigintIshSafe([])).toThrow('Expected bigint|string for amount, got object')
  })
})

describe('zeroBigInt', () => {
  it('should return 0n (never number 0)', () => {
    expect(zeroBigInt()).toBe(0n)
    expect(typeof zeroBigInt()).toBe('bigint')
  })
})

