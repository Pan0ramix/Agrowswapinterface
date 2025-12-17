/**
 * Comprehensive tests for centralized slippage handling utilities (Uniswap-Grade Safety)
 *
 * Tests cover:
 * - Result-based API (Strict vs Lenient)
 * - Fail-closed behavior for swaps
 * - Resilient behavior for liquidity/quote
 * - 50% slippage cap enforcement
 * - Prototype loss resilience
 * - Invariant enforcement (0 <= minimum <= amountOut)
 */

import { Currency, CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import {
  calculateAmountOutMinimumLenient,
  calculateAmountOutMinimumStrict,
  getComplement,
  getSlippageToleranceOrError,
  InvalidPercentDenominatorError,
  InvalidSlippageInputError,
  MAX_SLIPPAGE_TOLERANCE_BPS,
  normalizePercent,
} from 'uniswap/src/features/transactions/utils/slippage'
import { describe, expect, it, vi } from 'vitest'

// Mock logger to avoid platform dependencies during tests
vi.mock('utilities/src/logger/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('uniswap/src/config', () => ({
  getConfig: () => ({
    // Minimal config stub
    apiBaseUrlOverride: '',
    apiBaseUrlV2Override: '',
  }),
}))

// Test token setup
const TOKEN_A = new Token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 18, 'USDC', 'USD Coin')
const TOKEN_B = new Token(1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18, 'WETH', 'Wrapped Ether')

describe('normalizePercent', () => {
  it('should normalize a valid Percent instance', () => {
    const percent = new Percent(50, 10_000) // 0.5%
    const normalized = normalizePercent(percent)
    expect(normalized).not.toBeNull()
    expect(normalized?.equalTo(percent)).toBe(true)
  })

  it('should normalize Percent-like object with bigint', () => {
    const input = { numerator: 50n, denominator: 10_000n }
    const normalized = normalizePercent(input)
    expect(normalized).not.toBeNull()
    expect(normalized?.toFixed(2)).toBe('0.50')
  })

  it('should return null for invalid input (null)', () => {
    expect(normalizePercent(null)).toBeNull()
  })

  it('should return null for zero denominator', () => {
    expect(normalizePercent({ numerator: 50, denominator: 0 })).toBeNull()
  })

  it('should return null for NaN numerator', () => {
    expect(normalizePercent({ numerator: NaN, denominator: 10_000 })).toBeNull()
  })
})

describe('getSlippageToleranceOrError', () => {
  it('should return valid Percent for valid input', () => {
    const result = getSlippageToleranceOrError(new Percent(50, 10_000))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.toFixed(2)).toBe('0.50')
    }
  })

  it('should return error for null input', () => {
    const result = getSlippageToleranceOrError(null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidSlippageInputError)
    }
  })

  it('should return error for zero denominator', () => {
    const result = getSlippageToleranceOrError({ numerator: 50, denominator: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidPercentDenominatorError)
    }
  })

  it('should cap slippage at 50%', () => {
    const slippage = new Percent(10_000, 10_000) // 100%
    const result = getSlippageToleranceOrError(slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.toFixed(2)).toBe('50.00') // Capped at 50%
    }
  })

  it('should cap slippage > 50% at 50%', () => {
    const slippage = new Percent(15_000, 10_000) // 150%
    const result = getSlippageToleranceOrError(slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.toFixed(2)).toBe('50.00') // Capped at 50%
    }
  })
})

describe('getComplement', () => {
  it('should calculate complement for 0% slippage (100% complement)', () => {
    const slippage = new Percent(0, 10_000)
    const complement = getComplement(slippage)
    expect(complement.equalTo(new Percent(1, 1))).toBe(true) // 100%
  })

  it('should calculate complement for 0.5% slippage (99.5% complement)', () => {
    const slippage = new Percent(50, 10_000)
    const complement = getComplement(slippage)
    expect(complement.toFixed(2)).toBe('99.50')
  })

  it('should calculate complement for 50% slippage (50% complement)', () => {
    const slippage = new Percent(5_000, 10_000)
    const complement = getComplement(slippage)
    expect(complement.toFixed(2)).toBe('50.00')
  })

  it('should clamp complement to 0% for slippage > 100%', () => {
    const slippage = new Percent(15_000, 10_000) // 150%
    const complement = getComplement(slippage)
    expect(complement.equalTo(new Percent(0, 1))).toBe(true) // Clamped to 0%
  })

  it('should clamp complement to 100% for negative slippage', () => {
    const slippage = new Percent(-50, 10_000)
    const complement = getComplement(slippage)
    expect(complement.equalTo(new Percent(1, 1))).toBe(true) // Clamped to 100%
  })

  it('should work with Percent that lost complement() method', () => {
    const slippage = new Percent(50, 10_000)
    const slippageWithoutComplement = Object.create(Object.getPrototypeOf(slippage))
    slippageWithoutComplement.numerator = slippage.numerator
    slippageWithoutComplement.denominator = slippage.denominator
    delete (slippageWithoutComplement as any).complement

    const complement = getComplement(slippageWithoutComplement as Percent)
    expect(complement.toFixed(2)).toBe('99.50')
  })
})

describe('calculateAmountOutMinimumStrict - FAIL-CLOSED for swaps', () => {
  const amountOut = CurrencyAmount.fromRawAmount(TOKEN_A, 100_000_000_000_000_000_000n) // 100 tokens

  it('should calculate minimum for valid slippage', () => {
    const slippage = new Percent(50, 10_000) // 0.5%
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.quotient.toString()).toBe('99500000000000000000') // 99.5 tokens
    }
  })

  it('should return error for null input (FAIL-CLOSED)', () => {
    const result = calculateAmountOutMinimumStrict(amountOut, null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidSlippageInputError)
    }
  })

  it('should return error for undefined input', () => {
    const result = calculateAmountOutMinimumStrict(amountOut, undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidSlippageInputError)
    }
  })

  it('should return error for invalid object', () => {
    const result = calculateAmountOutMinimumStrict(amountOut, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidSlippageInputError)
    }
  })

  it('should return error for zero denominator', () => {
    const result = calculateAmountOutMinimumStrict(amountOut, { numerator: 50, denominator: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidPercentDenominatorError)
    }
  })

  it('should cap slippage at 50% and calculate correctly', () => {
    const slippage = new Percent(10_000, 10_000) // 100%
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Capped at 50% slippage -> 50% complement -> 50 tokens
      expect(result.value.quotient.toString()).toBe('50000000000000000000')
    }
  })

  it('should enforce invariant: minimum <= amountOut', () => {
    const slippage = new Percent(50, 10_000)
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(BigInt(result.value.quotient.toString())).toBeLessThanOrEqual(BigInt(amountOut.quotient.toString()))
    }
  })

  it('should enforce invariant: minimum >= 0', () => {
    const slippage = new Percent(50, 10_000)
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(BigInt(result.value.quotient.toString())).toBeGreaterThanOrEqual(0n)
    }
  })

  it('should handle 0% slippage (minimum = amountOut)', () => {
    const slippage = new Percent(0, 10_000)
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.equalTo(amountOut)).toBe(true)
    }
  })
})

describe('calculateAmountOutMinimumLenient - RESILIENT for liquidity/quote', () => {
  const amountOut = CurrencyAmount.fromRawAmount(TOKEN_A, 100_000_000_000_000_000_000n) // 100 tokens

  it('should calculate minimum for valid slippage', () => {
    const slippage = new Percent(50, 10_000) // 0.5%
    const minimum = calculateAmountOutMinimumLenient(amountOut, slippage)
    expect(minimum.quotient.toString()).toBe('99500000000000000000') // 99.5 tokens
  })

  it('should return amountOut for null input (strict safe fallback)', () => {
    const minimum = calculateAmountOutMinimumLenient(amountOut, null, { feature: 'liquidity' })
    expect(minimum.equalTo(amountOut)).toBe(true) // Safe fallback: amountOut (0% slippage tolerance)
  })

  it('should return amountOut for undefined input', () => {
    const minimum = calculateAmountOutMinimumLenient(amountOut, undefined, { feature: 'quote' })
    expect(minimum.equalTo(amountOut)).toBe(true)
  })

  it('should return amountOut for invalid object', () => {
    const minimum = calculateAmountOutMinimumLenient(amountOut, {}, { feature: 'liquidity' })
    expect(minimum.equalTo(amountOut)).toBe(true)
  })

  it('should NOT throw for any input (resilient mode)', () => {
    expect(() => {
      calculateAmountOutMinimumLenient(amountOut, null, { feature: 'liquidity' })
    }).not.toThrow()

    expect(() => {
      calculateAmountOutMinimumLenient(amountOut, {}, { feature: 'quote' })
    }).not.toThrow()

    expect(() => {
      calculateAmountOutMinimumLenient(amountOut, 'invalid', { feature: 'liquidity' })
    }).not.toThrow()
  })

  it('should cap slippage at 50%', () => {
    const slippage = new Percent(10_000, 10_000) // 100%
    const minimum = calculateAmountOutMinimumLenient(amountOut, slippage)
    // Capped at 50% slippage -> 50% complement -> 50 tokens
    expect(minimum.quotient.toString()).toBe('50000000000000000000')
  })

  it('should enforce invariant: minimum <= amountOut', () => {
    const slippage = new Percent(50, 10_000)
    const minimum = calculateAmountOutMinimumLenient(amountOut, slippage)
    expect(BigInt(minimum.quotient.toString())).toBeLessThanOrEqual(BigInt(amountOut.quotient.toString()))
  })

  it('should enforce invariant: minimum >= 0', () => {
    const slippage = new Percent(50, 10_000)
    const minimum = calculateAmountOutMinimumLenient(amountOut, slippage)
    expect(BigInt(minimum.quotient.toString())).toBeGreaterThanOrEqual(0n)
  })
})

describe('Slippage cap enforcement', () => {
  const amountOut = CurrencyAmount.fromRawAmount(TOKEN_A, 100_000_000_000_000_000_000n)

  it('should cap 51% at 50%', () => {
    const slippage = new Percent(5_100, 10_000) // 51%
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Capped at 50% -> 50% complement -> 50 tokens
      expect(result.value.quotient.toString()).toBe('50000000000000000000')
    }
  })

  it('should cap 200% at 50%', () => {
    const slippage = new Percent(20_000, 10_000) // 200%
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Capped at 50% -> 50% complement -> 50 tokens
      expect(result.value.quotient.toString()).toBe('50000000000000000000')
    }
  })

  it('should allow exactly 50%', () => {
    const slippage = new Percent(5_000, 10_000) // 50%
    const result = calculateAmountOutMinimumStrict(amountOut, slippage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.quotient.toString()).toBe('50000000000000000000') // 50 tokens
    }
  })
})

describe('Prototype loss resilience', () => {
  const amountOut = CurrencyAmount.fromRawAmount(TOKEN_A, 100_000_000_000_000_000_000n)

  it('should work with Percent-like object (no prototype)', () => {
    const slippageLike = { numerator: 50n, denominator: 10_000n }
    const result = calculateAmountOutMinimumStrict(amountOut, slippageLike)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.quotient.toString()).toBe('99500000000000000000')
    }
  })

  it('should work with Percent instance that lost complement() method', () => {
    const slippage = new Percent(50, 10_000)
    const slippageLike = {
      numerator: slippage.numerator,
      denominator: slippage.denominator,
    }

    const result = calculateAmountOutMinimumStrict(amountOut, slippageLike)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.quotient.toString()).toBe('99500000000000000000')
    }
  })
})

describe('Edge cases', () => {
  it('should handle very small amounts correctly', () => {
    const smallAmount = CurrencyAmount.fromRawAmount(TOKEN_A, 1n)
    const slippage = new Percent(50, 10_000) // 0.5%
    const result = calculateAmountOutMinimumStrict(smallAmount, slippage)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(BigInt(result.value.quotient.toString())).toBeLessThanOrEqual(1n)
      expect(BigInt(result.value.quotient.toString())).toBeGreaterThanOrEqual(0n)
    }
  })

  it('should handle very large amounts correctly', () => {
    const largeAmount = CurrencyAmount.fromRawAmount(TOKEN_A, 1000000000000000000000000000000000000n)
    const slippage = new Percent(50, 10_000) // 0.5%
    const result = calculateAmountOutMinimumStrict(largeAmount, slippage)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(BigInt(result.value.quotient.toString())).toBeLessThanOrEqual(BigInt(largeAmount.quotient.toString()))
      expect(BigInt(result.value.quotient.toString())).toBeGreaterThanOrEqual(0n)
    }
  })

  it('should preserve currency type', () => {
    const slippage = new Percent(50, 10_000)
    const result = calculateAmountOutMinimumStrict(
      CurrencyAmount.fromRawAmount(TOKEN_B, 1_000_000_000_000_000_000n),
      slippage,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.currency.equals(TOKEN_B)).toBe(true)
    }
  })
})

describe('MAX_SLIPPAGE_TOLERANCE_BPS constant', () => {
  it('should be 5000 (50%)', () => {
    expect(MAX_SLIPPAGE_TOLERANCE_BPS).toBe(5_000)
  })
})
