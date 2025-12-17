/**
 * Unit tests for locales.web.ts
 * 
 * Tests to ensure getDeviceLocales handles missing chrome.i18n gracefully
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock chrome globally
const mockChrome = {
  i18n: {
    getUILanguage: vi.fn(),
  },
}

describe('getDeviceLocales (web)', () => {
  beforeEach(() => {
    // @ts-expect-error - chrome is global in extension context
    global.chrome = undefined
    // @ts-expect-error - navigator mock
    global.navigator = {
      language: 'en-US',
      languages: ['en-US', 'en'],
    }
  })

  afterEach(() => {
    // @ts-expect-error
    delete global.chrome
    vi.restoreAllMocks()
  })

  it('should fallback to navigator.language when chrome.i18n is undefined', async () => {
    // @ts-expect-error
    global.chrome = undefined

    // Dynamic import to avoid module caching issues
    const { getDeviceLocales } = await import('./locales.web')
    const result = getDeviceLocales()

    expect(result).toHaveLength(1)
    expect(result[0].languageCode).toBe('en-US')
  })

  it('should fallback to navigator.language when chrome.i18n.getUILanguage is not a function', async () => {
    // @ts-expect-error
    global.chrome = { i18n: {} }

    const { getDeviceLocales } = await import('./locales.web')
    const result = getDeviceLocales()

    expect(result).toHaveLength(1)
    expect(result[0].languageCode).toBe('en-US')
  })

  it('should use chrome.i18n.getUILanguage when available', async () => {
    const mockGetUILanguage = vi.fn(() => 'fr-FR')
    // @ts-expect-error
    global.chrome = {
      i18n: {
        getUILanguage: mockGetUILanguage,
      },
    }

    const { getDeviceLocales } = await import('./locales.web')
    const result = getDeviceLocales()

    expect(result).toHaveLength(1)
    expect(result[0].languageCode).toBe('fr-FR')
    expect(mockGetUILanguage).toHaveBeenCalled()
  })

  it('should fallback to default when chrome.i18n.getUILanguage throws', async () => {
    const mockGetUILanguage = vi.fn(() => {
      throw new Error('Chrome API error')
    })
    // @ts-expect-error
    global.chrome = {
      i18n: {
        getUILanguage: mockGetUILanguage,
      },
    }
    // @ts-expect-error
    global.navigator = undefined

    const { getDeviceLocales } = await import('./locales.web')
    const result = getDeviceLocales()

    expect(result).toHaveLength(1)
    expect(result[0].languageCode).toBe('en')
  })

  it('should handle navigator.languages array', async () => {
    // @ts-expect-error
    global.chrome = undefined
    // @ts-expect-error
    global.navigator = {
      languages: ['es-ES', 'es', 'en'],
      language: 'en-US',
    }

    const { getDeviceLocales } = await import('./locales.web')
    const result = getDeviceLocales()

    expect(result).toHaveLength(1)
    expect(result[0].languageCode).toBe('es-ES') // Should prefer first in languages array
  })
})
