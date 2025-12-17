/**
 * Unit tests for parseCollectResult
 *
 * Tests to ensure parseCollectResult rejects numbers and returns bigint
 */

import { describe, expect, it, vi } from 'vitest'

// Mock modules that might import PNG/assets to prevent test failures
vi.mock('utilities/src/logger/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('uniswap/src/features/providers/createViemClient', () => ({
  createViemClient: vi.fn(),
}))

vi.mock('uniswap/src/constants/agroswapAddresses', () => ({
  AGROSWAP_V3_CORE_FACTORY_ADDRESSES: {},
  AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES: {},
}))

vi.mock('uniswap/src/constants/v3Addresses', () => ({
  getV3FactoryAddress: vi.fn(),
  getPositionManagerAddress: vi.fn(),
}))

vi.mock('@uniswap/sdk-core', () => ({
  Currency: {},
  CurrencyAmount: {},
  Token: {},
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES: {},
  V3_CORE_FACTORY_ADDRESSES: {},
}))

// Mock PNG/image imports
vi.mock('**/*.png', () => ({}))
vi.mock('**/*.svg', () => ({}))

import { parseCollectResult } from 'uniswap/src/features/positions/hooks/useOnChainCollectableFees'

describe('parseCollectResult', () => {
  it('should parse array result with bigint values', () => {
    const result = [0n, 0n]
    const parsed = parseCollectResult(result)
    expect(parsed.amount0).toBe(0n)
    expect(parsed.amount1).toBe(0n)
    expect(typeof parsed.amount0).toBe('bigint')
    expect(typeof parsed.amount1).toBe('bigint')
  })

  it('should parse array result with string values', () => {
    const result = ['0', '0']
    const parsed = parseCollectResult(result)
    expect(parsed.amount0).toBe(0n)
    expect(parsed.amount1).toBe(0n)
  })

  it('should parse array result with hex string values', () => {
    const result = ['0x0', '0xff']
    const parsed = parseCollectResult(result)
    expect(parsed.amount0).toBe(0n)
    expect(parsed.amount1).toBe(255n)
  })

  it('should REJECT array result with number values (critical: prevents JSBI error)', () => {
    const result = [0, 0]
    expect(() => parseCollectResult(result)).toThrow('Invalid BigintIsh: expected bigint or string, got number')
  })

  it('should parse object result with bigint values', () => {
    const result = { amount0: 0n, amount1: 0n }
    const parsed = parseCollectResult(result)
    expect(parsed.amount0).toBe(0n)
    expect(parsed.amount1).toBe(0n)
  })

  it('should parse object result with string values', () => {
    const result = { amount0: '0', amount1: '0' }
    const parsed = parseCollectResult(result)
    expect(parsed.amount0).toBe(0n)
    expect(parsed.amount1).toBe(0n)
  })

  it('should REJECT object result with number values (critical: prevents JSBI error)', () => {
    const result = { amount0: 0, amount1: 0 }
    expect(() => parseCollectResult(result)).toThrow('Invalid BigintIsh: expected bigint or string, got number')
  })

  it('should parse nested result object', () => {
    const result = { result: [100n, 200n] }
    const parsed = parseCollectResult(result)
    expect(parsed.amount0).toBe(100n)
    expect(parsed.amount1).toBe(200n)
  })

  it('should reject negative values', () => {
    expect(() => parseCollectResult([-1n, 0n])).toThrow('amounts must be non-negative')
    expect(() => parseCollectResult([0n, -1n])).toThrow('amounts must be non-negative')
  })

  it('should reject invalid array lengths', () => {
    expect(() => parseCollectResult([])).toThrow('expected length >= 2')
    expect(() => parseCollectResult([0n])).toThrow('expected length >= 2')
  })

  it('should reject invalid object shapes', () => {
    expect(() => parseCollectResult({ foo: 1n })).toThrow('expected { amount0, amount1 }')
  })

  it('should reject invalid types', () => {
    expect(() => parseCollectResult('string')).toThrow('expected array or object')
    expect(() => parseCollectResult(123)).toThrow('expected array or object')
    expect(() => parseCollectResult(null)).toThrow('expected array or object')
  })
})

