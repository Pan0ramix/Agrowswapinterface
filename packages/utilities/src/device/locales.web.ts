import { getChrome } from 'utilities/src/chrome/chrome'
import { DEFAULT_LANGUAGE_CODE, DEFAULT_LANGUAGE_TAG, DeviceLocale } from 'utilities/src/device/constants'
import { logger } from 'utilities/src/logger/logger'

export function getDeviceLocales(): DeviceLocale[] {
  try {
    // Safely access chrome.i18n if available (extension context)
    // Otherwise fall back to navigator.language (web browser context)
    const chrome = getChrome()

    // Guard: Check if chrome.i18n exists and getUILanguage is a function before calling
    if (chrome?.i18n && typeof chrome.i18n.getUILanguage === 'function') {
      try {
        const uiLanguage = chrome.i18n.getUILanguage()
        if (uiLanguage) {
          return [{ languageCode: uiLanguage, languageTag: uiLanguage }]
        }
      } catch (chromeError) {
        // Chrome API may throw in some contexts, fall through to navigator
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(
            'locales.web.ts',
            'getDeviceLocales',
            'chrome.i18n.getUILanguage() failed, falling back to navigator',
            { error: chromeError instanceof Error ? chromeError.message : String(chromeError) },
          )
        }
      }
    }

    // Fallback to navigator.languages (preferred) or navigator.language
    if (typeof navigator !== 'undefined') {
      const navigatorLanguage = navigator.languages[0] || navigator.language
      if (navigatorLanguage) {
        return [{ languageCode: navigatorLanguage, languageTag: navigatorLanguage }]
      }
    }
  } catch (e) {
    logger.error(e, {
      level: 'warn',
      tags: { file: 'locales.web.ts', function: 'getDeviceLocales' },
    })
  }
  // Final fallback to default
  return [
    {
      languageCode: DEFAULT_LANGUAGE_CODE,
      languageTag: DEFAULT_LANGUAGE_TAG,
    },
  ]
}
