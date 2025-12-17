/**
 * Tests for on-chain math fees provider
 * Focus: fee growth calculation helpers and provider logic
 */

// Mock logger first to avoid platform dependencies
import { vi } from 'vitest'

vi.mock('utilities/src/logger/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock createViemClient to avoid RPC dependencies
vi.mock('uniswap/src/features/providers/createViemClient', () => ({
  createViemClient: vi.fn(),
}))

// Mock constants that might import assets
vi.mock('uniswap/src/constants/agroswapAddresses', () => ({
  AGROSWAP_V3_CORE_FACTORY_ADDRESSES: {},
}))

vi.mock('uniswap/src/constants/v3Addresses', () => ({
  getV3FactoryAddress: vi.fn(),
}))

// Mock hooks that might import UI
vi.mock('../../hooks/useOnChainCollectableFees', () => ({
  safeReadString: vi.fn(),
  readDecimalsRequired: vi.fn(),
  fallbackSymbol: vi.fn((addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`),
  getTokenMetadataCacheKey: vi.fn((chainId: number, addr: string) => `${chainId}:${addr.toLowerCase()}`),
}))

import {
  computeFeeGrowthInsideX128,
  computeFeesOwed,
} from 'uniswap/src/features/positions/fees/providers/onchainMathFeesProvider'
// Now import test utilities and functions to test
import { describe, expect, it } from 'vitest'

const Q128 = 1n << 128n

describe('computeFeeGrowthInsideX128', () => {
  describe('tickCurrent < tickLower (below range)', () => {
    it('should compute inside = lowerOutside - upperOutside', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 100,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 500n,
        feeGrowthOutsideUpperX128: 200n,
      })

      // inside = lowerOutside - upperOutside = 500 - 200 = 300
      expect(result).toBe(300n)
    })

    it('should handle negative result and clamp to 0', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 100,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 100n, // Lower than upper
        feeGrowthOutsideUpperX128: 500n,
      })

      // inside = lowerOutside - upperOutside = 100 - 500 = -400 → clamped to 0
      expect(result).toBe(0n)
    })
  })

  describe('tickCurrent >= tickUpper (above range)', () => {
    it('should compute inside = upperOutside - lowerOutside', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 400,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 200n,
        feeGrowthOutsideUpperX128: 500n,
      })

      // inside = upperOutside - lowerOutside = 500 - 200 = 300
      expect(result).toBe(300n)
    })

    it('should handle negative result and clamp to 0', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 400,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 500n, // Higher than upper
        feeGrowthOutsideUpperX128: 100n,
      })

      // inside = upperOutside - lowerOutside = 100 - 500 = -400 → clamped to 0
      expect(result).toBe(0n)
    })
  })

  describe('tickLower <= tickCurrent < tickUpper (in range)', () => {
    it('should compute inside = global - lowerOutside - upperOutside', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 250,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 200n,
        feeGrowthOutsideUpperX128: 300n,
      })

      // inside = global - lowerOutside - upperOutside = 1000 - 200 - 300 = 500
      expect(result).toBe(500n)
    })

    it('should handle negative result and clamp to 0', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 250,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 400n,
        feeGrowthOutsideLowerX128: 200n,
        feeGrowthOutsideUpperX128: 300n,
      })

      // inside = global - lowerOutside - upperOutside = 400 - 200 - 300 = -100 → clamped to 0
      expect(result).toBe(0n)
    })
  })

  describe('edge cases', () => {
    it('should handle tickCurrent exactly at tickLower', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 200,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 200n,
        feeGrowthOutsideUpperX128: 300n,
      })

      // tickCurrent === tickLower, so in range: 1000 - 200 - 300 = 500
      expect(result).toBe(500n)
    })

    it('should handle tickCurrent exactly at tickUpper', () => {
      const result = computeFeeGrowthInsideX128({
        tickCurrent: 300,
        tickLower: 200,
        tickUpper: 300,
        feeGrowthGlobalX128: 1000n,
        feeGrowthOutsideLowerX128: 200n,
        feeGrowthOutsideUpperX128: 500n,
      })

      // tickCurrent >= tickUpper, so above range: 500 - 200 = 300
      expect(result).toBe(300n)
    })
  })
})

describe('computeFeesOwed', () => {
  it('should compute fees from positive growth delta', () => {
    const liquidity = 1000n
    const feeGrowthInsideX128 = 2000n
    const feeGrowthInsideLastX128 = 1000n
    const tokensOwed = 50n

    const result = computeFeesOwed({
      liquidity,
      feeGrowthInsideX128,
      feeGrowthInsideLastX128,
      tokensOwed,
    })

    // delta = 2000 - 1000 = 1000
    // feesFromGrowth = (1000 * 1000) / Q128
    const expectedFeesFromGrowth = (liquidity * 1000n) / Q128
    const expectedOwed = tokensOwed + expectedFeesFromGrowth

    expect(result).toBe(expectedOwed)
  })

  it('should compute fees from zero delta', () => {
    const liquidity = 1000n
    const feeGrowthInsideX128 = 1000n
    const feeGrowthInsideLastX128 = 1000n
    const tokensOwed = 50n

    const result = computeFeesOwed({
      liquidity,
      feeGrowthInsideX128,
      feeGrowthInsideLastX128,
      tokensOwed,
    })

    // delta = 0, so feesFromGrowth = 0
    // owed = tokensOwed + 0 = tokensOwed
    expect(result).toBe(tokensOwed)
  })

  it('should clamp negative delta to 0', () => {
    const liquidity = 1000n
    const feeGrowthInsideX128 = 500n // Lower than last
    const feeGrowthInsideLastX128 = 1000n
    const tokensOwed = 50n

    const result = computeFeesOwed({
      liquidity,
      feeGrowthInsideX128,
      feeGrowthInsideLastX128,
      tokensOwed,
    })

    // delta = 500 - 1000 = -500 → clamped to 0
    // feesFromGrowth = 0
    // owed = tokensOwed + 0 = tokensOwed
    expect(result).toBe(tokensOwed)
  })

  it('should handle large liquidity and growth values', () => {
    const liquidity = 1000000000000n // 1e12
    const feeGrowthInsideX128 = Q128 * 100n // 100 * Q128
    const feeGrowthInsideLastX128 = Q128 * 50n // 50 * Q128
    const tokensOwed = 0n

    const result = computeFeesOwed({
      liquidity,
      feeGrowthInsideX128,
      feeGrowthInsideLastX128,
      tokensOwed,
    })

    // delta = 100 * Q128 - 50 * Q128 = 50 * Q128
    // feesFromGrowth = (liquidity * 50 * Q128) / Q128 = liquidity * 50
    const expectedFeesFromGrowth = liquidity * 50n
    expect(result).toBe(expectedFeesFromGrowth)
  })
})

