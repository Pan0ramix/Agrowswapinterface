import { createContext, ReactNode, useContext, useMemo } from 'react'
// biome-ignore lint/style/noRestrictedImports: legacy import will be migrated
import { useFiatConverter } from 'uniswap/src/features/fiatCurrency/conversion'
import { FiatCurrency } from 'uniswap/src/features/fiatCurrency/constants'
// biome-ignore lint/style/noRestrictedImports: legacy import will be migrated
import { useLocalizedFormatter } from 'uniswap/src/features/language/formatter'

export type LocalizationContextState = {
  conversionRate: ReturnType<typeof useFiatConverter>['conversionRate']
  convertFiatAmount: ReturnType<typeof useFiatConverter>['convertFiatAmount']
  convertFiatAmountFormatted: ReturnType<typeof useFiatConverter>['convertFiatAmountFormatted']
  formatNumberOrString: ReturnType<typeof useLocalizedFormatter>['formatNumberOrString']
  formatCurrencyAmount: ReturnType<typeof useLocalizedFormatter>['formatCurrencyAmount']
  formatPercent: ReturnType<typeof useLocalizedFormatter>['formatPercent']
  addFiatSymbolToNumber: ReturnType<typeof useLocalizedFormatter>['addFiatSymbolToNumber']
}

export const LocalizationContext = createContext<LocalizationContextState | undefined>(undefined)

export function LocalizationContextProvider({ children }: { children: ReactNode }): JSX.Element {
  const { formatNumberOrString, formatCurrencyAmount, formatPercent, addFiatSymbolToNumber } = useLocalizedFormatter()

  const { convertFiatAmount, convertFiatAmountFormatted, conversionRate } = useFiatConverter({
    formatNumberOrString,
  })

  const state = useMemo<LocalizationContextState>(
    (): LocalizationContextState => ({
      conversionRate,
      convertFiatAmount,
      convertFiatAmountFormatted,
      formatNumberOrString,
      formatCurrencyAmount,
      formatPercent,
      addFiatSymbolToNumber,
    }),
    [
      addFiatSymbolToNumber,
      conversionRate,
      convertFiatAmount,
      convertFiatAmountFormatted,
      formatCurrencyAmount,
      formatNumberOrString,
      formatPercent,
    ],
  )

  return <LocalizationContext.Provider value={state}>{children}</LocalizationContext.Provider>
}

/**
 * Creates a fallback localization context state with no-op functions
 * Used when the provider is not available (should not happen in normal flow)
 */
function createFallbackLocalizationContext(): LocalizationContextState {
  const noOpFormat = () => ''
  const noOpConvert = (amount: number) => ({ amount, currency: FiatCurrency.UnitedStatesDollar })
  const noOpConvertFormatted = () => ''

  return {
    conversionRate: undefined,
    convertFiatAmount: noOpConvert,
    convertFiatAmountFormatted: noOpConvertFormatted,
    formatNumberOrString: noOpFormat,
    formatCurrencyAmount: noOpFormat,
    formatPercent: noOpFormat,
    addFiatSymbolToNumber: noOpFormat,
  }
}

export const useLocalizationContext = (): LocalizationContextState => {
  const localizationContext = useContext(LocalizationContext)

  if (localizationContext === undefined) {
    // In development, log a warning but don't crash
    // In production, return a fallback to prevent app crashes
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        '`useLocalizationContext` called outside of `LocalizationContextProvider`. Using fallback. This may indicate a missing provider in the component tree.',
      )
    }
    return createFallbackLocalizationContext()
  }

  return localizationContext
}
