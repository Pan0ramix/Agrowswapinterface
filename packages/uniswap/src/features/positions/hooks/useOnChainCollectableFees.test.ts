/**
 * Tests for useOnChainCollectableFees hook
 * Focus: metadata resilience, parseCollectResult robustness, UI data-source logic
 */

import { describe, expect, it, vi } from 'vitest'

// Mock logger to avoid platform dependencies during tests
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
  AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES: {},
}))

vi.mock('uniswap/src/constants/v3Addresses', () => ({
  getPositionManagerAddress: vi.fn(),
}))

// Now import the functions to test (after mocks)
import {
  fallbackSymbol,
  getTokenMetadataCacheKey,
  normalizeAddressKey,
  parseCollectResult,
} from 'uniswap/src/features/positions/hooks/useOnChainCollectableFees'

describe('parseCollectResult', () => {
  describe('handles array shape', () => {
    it('should parse [bigint, bigint] correctly', () => {
      const result = [100n, 200n]
      const parsed = parseCollectResult(result)
      expect(parsed.amount0).toBe(100n)
      expect(parsed.amount1).toBe(200n)
    })

    it('should parse [string, string] (hex) correctly', () => {
      const result = ['0x64', '0xc8'] // 100, 200
      const parsed = parseCollectResult(result)
      expect(parsed.amount0).toBe(100n)
      expect(parsed.amount1).toBe(200n)
    })

    it('should reject number types', () => {
      const result = [0, 0] // Numbers - should throw
      expect(() => parseCollectResult(result)).toThrow('Invalid BigintIsh')
    })

    it('should reject negative amounts', () => {
      const result = [-1n, 0n]
      expect(() => parseCollectResult(result)).toThrow('non-negative')
    })
  })

  describe('handles object shape', () => {
    it('should parse { amount0: bigint, amount1: bigint } correctly', () => {
      const result = { amount0: 100n, amount1: 200n }
      const parsed = parseCollectResult(result)
      expect(parsed.amount0).toBe(100n)
      expect(parsed.amount1).toBe(200n)
    })

    it('should reject number types in object', () => {
      const result = { amount0: 0, amount1: 0 } // Numbers - should throw
      expect(() => parseCollectResult(result)).toThrow('Invalid BigintIsh')
    })
  })

  describe('handles nested result field', () => {
    it('should unwrap { result: [amount0, amount1] }', () => {
      const result = { result: [100n, 200n] }
      const parsed = parseCollectResult(result)
      expect(parsed.amount0).toBe(100n)
      expect(parsed.amount1).toBe(200n)
    })

    it('should unwrap { result: { amount0, amount1 } }', () => {
      const result = { result: { amount0: 100n, amount1: 200n } }
      const parsed = parseCollectResult(result)
      expect(parsed.amount0).toBe(100n)
      expect(parsed.amount1).toBe(200n)
    })
  })

  describe('rejects invalid shapes', () => {
    it('should throw on empty array', () => {
      expect(() => parseCollectResult([])).toThrow('length >= 2')
    })

    it('should throw on object without amount0/amount1', () => {
      expect(() => parseCollectResult({ foo: 1n })).toThrow('expected { amount0, amount1 }')
    })

    it('should throw on primitive types', () => {
      expect(() => parseCollectResult('string')).toThrow('expected array or object')
      expect(() => parseCollectResult(123)).toThrow('expected array or object')
    })
  })
})

describe('fallbackSymbol', () => {
  it('should generate fallback symbol from address', () => {
    const address = '0x1234567890123456789012345678901234567890'
    expect(fallbackSymbol(address)).toBe('0x1234…7890')
  })

  it('should handle short addresses', () => {
    const address = '0x1234'
    expect(fallbackSymbol(address)).toBe('0x1234')
  })

  it('should handle empty address', () => {
    expect(fallbackSymbol('')).toBe('')
  })
})

describe('normalizeAddressKey', () => {
  it('should lowercase addresses', () => {
    expect(normalizeAddressKey('0xAbC123')).toBe('0xabc123')
  })

  it('should trim whitespace', () => {
    expect(normalizeAddressKey('  0xabc123  ')).toBe('0xabc123')
  })

  it('should handle mixed case', () => {
    expect(normalizeAddressKey('0xAbCdEf')).toBe('0xabcdef')
  })

  it('should handle already lowercase', () => {
    expect(normalizeAddressKey('0xabc123')).toBe('0xabc123')
  })
})

describe('getTokenMetadataCacheKey', () => {
  it('should generate same key for same token with different address casing', () => {
    const chainId = 84532
    const address1 = '0xAbC1234567890123456789012345678901234567'
    const address2 = '0xabc1234567890123456789012345678901234567'
    const address3 = '0xABC1234567890123456789012345678901234567'

    const key1 = getTokenMetadataCacheKey(chainId, address1)
    const key2 = getTokenMetadataCacheKey(chainId, address2)
    const key3 = getTokenMetadataCacheKey(chainId, address3)

    expect(key1).toBe(key2)
    expect(key2).toBe(key3)
    expect(key1).toBe(`${chainId}:${address2.toLowerCase()}`)
  })

  it('should generate different keys for different chains', () => {
    const address = '0xabc123'
    const key1 = getTokenMetadataCacheKey(1, address)
    const key2 = getTokenMetadataCacheKey(84532, address)

    expect(key1).not.toBe(key2)
    expect(key1).toBe(`1:${address}`)
    expect(key2).toBe(`84532:${address}`)
  })

  it('should normalize addresses with whitespace', () => {
    const chainId = 84532
    const address1 = '0xabc123'
    const address2 = '  0xabc123  '
    const address3 = '0xAbC123'

    const key1 = getTokenMetadataCacheKey(chainId, address1)
    const key2 = getTokenMetadataCacheKey(chainId, address2)
    const key3 = getTokenMetadataCacheKey(chainId, address3)

    expect(key1).toBe(key2)
    expect(key2).toBe(key3)
  })
})

// Note: Integration tests for fetchTokenMetadata, addressToCurrency, and UI logic
// would require more complex mocking (publicClient, React hooks, etc.)
// These are documented below but not implemented as unit tests.

describe('Token metadata resilience (documentation)', () => {
  describe('decimals required behavior', () => {
    it('should fail if decimals() throws', () => {
      // This would be tested with a mocked publicClient that throws on decimals()
      // Expected behavior:
      // - fetchTokenMetadata returns null
      // - addressToCurrency throws
      // - Hook returns { data: undefined, isError: true }
    })
  })

  describe('symbol/name optional behavior', () => {
    it('should use fallback symbol if symbol() fails', () => {
      // Mock publicClient where:
      // - decimals() succeeds → returns 18
      // - symbol() throws → should use fallbackSymbol(address)
      // - name() throws → should use ''
      // Expected: metadata returned with fallback symbol (not null)
    })
  })
})

describe('UI data-source logic (documentation)', () => {
  describe('data-source selection', () => {
    it('should select "onchain" when onChainFees.data exists (even if amounts are 0)', () => {
      // Mock: onChainFees.data = { amount0: CurrencyAmount(0), amount1: CurrencyAmount(0), ... }
      // Expected: dataSource = 'onchain', fee0Amount = CurrencyAmount(0) (not undefined)
    })

    it('should select "fallback" when onChainFees.data is undefined but positionInfo.fee0Amount exists', () => {
      // Mock: onChainFees.data = undefined, positionInfo.fee0Amount = CurrencyAmount(100)
      // Expected: dataSource = 'fallback', fee0Amount = CurrencyAmount(100)
    })

    it('should select "none" when both onChainFees.data and positionInfo.fee0Amount are undefined', () => {
      // Mock: onChainFees.data = undefined, positionInfo.fee0Amount = undefined
      // Expected: dataSource = 'none', fee0Amount = undefined
    })
  })

  describe('UI rendering', () => {
    it('should render "0" when dataSource is "onchain" and amount is 0', () => {
      // Expected: UI shows "0" (not "—") because on-chain data is authoritative
    })

    it('should render "—" when dataSource is "none"', () => {
      // Expected: UI shows "—" (no data available)
    })

    it('should render fallback amount with "(estimated)" label when dataSource is "fallback"', () => {
      // Expected: UI shows amount + "(estimated)" label
    })
  })
})
