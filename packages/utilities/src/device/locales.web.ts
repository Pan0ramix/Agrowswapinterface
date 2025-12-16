import { getChrome } from 'utilities/src/chrome/chrome'
import { DEFAULT_LANGUAGE_CODE, DEFAULT_LANGUAGE_TAG, DeviceLocale } from 'utilities/src/device/constants'
import { logger } from 'utilities/src/logger/logger'

export function getDeviceLocales(): DeviceLocale[] {
  try {
    // Safely access chrome.i18n if available (extension context)
    // Otherwise fall back to navigator.language (web browser context)
    const chrome = getChrome()
    const uiLanguage = chrome?.i18n.getUILanguage()
    if (uiLanguage) {
      return [{ languageCode: uiLanguage, languageTag: uiLanguage }]
    }
    // Fallback to navigator language
    const navigatorLanguage = navigator.language || navigator.languages[0]
    if (navigatorLanguage) {
      return [{ languageCode: navigatorLanguage, languageTag: navigatorLanguage }]
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
