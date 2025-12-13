import { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { CurrencyInputPanelProps } from 'uniswap/src/components/CurrencyInputPanel/types'
import { usePrevious } from 'utilities/src/react/hooks'

/** Returns an animated opacity based on current indicative and full quote state  */
export function useRefetchAnimationStyle({
  currencyAmount,
  isLoading,
  isIndicativeLoading,
  valueIsIndicative,
}: Pick<CurrencyInputPanelProps, 'currencyAmount' | 'isLoading' | 'isIndicativeLoading' | 'valueIsIndicative'>): {
  opacity: number
} {
  const loadingFlexProgress = useSharedValue(1)

  loadingFlexProgress.value = withRepeat(
    withSequence(
      withTiming(0.4, { duration: 400, easing: Easing.ease }),
      withTiming(1, { duration: 400, easing: Easing.ease }),
    ),
    -1,
    true,
  )

  const previousAmount = usePrevious(currencyAmount)

  // Safe comparator for CurrencyAmount/Fraction objects and primitives
  const amountIsTheSame = (() => {
    if (!currencyAmount || !previousAmount) {
      return false
    }

    // If both have equalTo method, use it (CurrencyAmount/Fraction)
    if (typeof previousAmount.equalTo === 'function' && typeof currencyAmount.equalTo === 'function') {
      try {
        return previousAmount.equalTo(currencyAmount)
      } catch {
        // Fall through to other comparison methods
      }
    }

    // If both have quotient property, compare quotients (JSBI-based amounts)
    if (
      previousAmount.quotient != null &&
      currencyAmount.quotient != null &&
      typeof previousAmount.quotient.toString === 'function' &&
      typeof currencyAmount.quotient.toString === 'function'
    ) {
      return previousAmount.quotient.toString() === currencyAmount.quotient.toString()
    }

    // If both are primitive string/number, compare directly
    if (
      (typeof previousAmount === 'string' || typeof previousAmount === 'number') &&
      (typeof currencyAmount === 'string' || typeof currencyAmount === 'number')
    ) {
      return String(previousAmount) === String(currencyAmount)
    }

    // Fallback to string comparison
    return String(previousAmount) === String(currencyAmount)
  })()

  const noIndicativeUI = !isIndicativeLoading && !valueIsIndicative

  // The component is 'refetching' the full quote when the amount hasn't changed, and there is no indicative UI being displayed.
  const isRefetching = isLoading && amountIsTheSame && noIndicativeUI

  return useAnimatedStyle(
    () => ({
      opacity: isRefetching ? loadingFlexProgress.value : 1,
    }),
    [isRefetching, loadingFlexProgress],
  )
}
