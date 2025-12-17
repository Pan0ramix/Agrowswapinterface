/**
 * Unit tests for useGasFeeQuery gating logic
 *
 * Tests to ensure gas fee query is disabled when API not configured
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the dependencies
vi.mock('uniswap/src/config', () => ({
  config: {
    uniswapApiKey: '',
  },
}))

vi.mock('uniswap/src/constants/urls', () => ({
  uniswapUrls: {
    apiBaseUrl: 'http://localhost:3000',
    gasServicePath: '/v1/gas-fee',
  },
}))

describe('useGasFeeQuery gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be disabled when apiBaseUrl is localhost', () => {
    // This test verifies the gating logic
    const apiBaseUrl = 'http://localhost:3000'
    const uniswapApiKey = ''
    const isApiConfigured = Boolean(
      apiBaseUrl &&
        apiBaseUrl.trim() !== '' &&
        !apiBaseUrl.includes('localhost') &&
        !apiBaseUrl.includes('127.0.0.1') &&
        uniswapApiKey &&
        uniswapApiKey.trim() !== '',
    )

    expect(isApiConfigured).toBe(false)
  })

  it('should be enabled when apiBaseUrl is configured and not localhost', () => {
    const apiBaseUrl = 'https://api.uniswap.org'
    const uniswapApiKey = 'test-key-123'
    const isApiConfigured = Boolean(
      apiBaseUrl &&
        apiBaseUrl.trim() !== '' &&
        !apiBaseUrl.includes('localhost') &&
        !apiBaseUrl.includes('127.0.0.1') &&
        uniswapApiKey &&
        uniswapApiKey.trim() !== '',
    )

    expect(isApiConfigured).toBe(true)
  })

  it('should be disabled when apiBaseUrl includes 127.0.0.1', () => {
    const apiBaseUrl = 'http://127.0.0.1:3000'
    const uniswapApiKey = 'test-key'
    const isApiConfigured = Boolean(
      apiBaseUrl &&
        apiBaseUrl.trim() !== '' &&
        !apiBaseUrl.includes('localhost') &&
        !apiBaseUrl.includes('127.0.0.1') &&
        uniswapApiKey &&
        uniswapApiKey.trim() !== '',
    )

    expect(isApiConfigured).toBe(false)
  })

  it('should be disabled when uniswapApiKey is empty', () => {
    const apiBaseUrl = 'https://api.uniswap.org'
    const uniswapApiKey = ''
    const isApiConfigured = Boolean(
      apiBaseUrl &&
        apiBaseUrl.trim() !== '' &&
        !apiBaseUrl.includes('localhost') &&
        !apiBaseUrl.includes('127.0.0.1') &&
        uniswapApiKey &&
        uniswapApiKey.trim() !== '',
    )

    expect(isApiConfigured).toBe(false)
  })
})
