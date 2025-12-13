import type { PropsWithChildren } from 'react'
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import type { TradeableAsset } from 'uniswap/src/entities/assets'
import { useMaxAmountSpend } from 'uniswap/src/features/gas/hooks/useMaxAmountSpend'
import { useSwapAnalytics } from 'uniswap/src/features/transactions/swap/analytics'
import {
  createSwapFormStore,
  INITIAL_SWAP_FORM_STATE,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/createSwapFormStore'
import { useDebouncedSwapFormAmounts } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useDebouncedSwapFormAmounts'
import { useDefaultSwapFormState } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useDefaultSwapFormState'
import { useDerivedSwapInfo } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useDerivedSwapInfo'
import { useFreezeWhileSubmitting } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useFreezeWhileSubmitting'
import { useOpenOutputSelectorOnPrefilledStateChange } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useOpenOutputSelectorOnPrefilledStateChange'
import { useUpdateSwapFormFromPrefilledCurrencies } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useUpdateSwapFormFromPrefilledCurrencies'
import { SwapFormStoreContext } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/SwapFormStoreContext'
import type {
  SwapFormState,
  SwapFormStateForConsumers,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/types'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import { TransactionType } from 'uniswap/src/features/transactions/types/transactionDetails'
import { CurrencyField } from 'uniswap/src/types/currency'
import { useEvent } from 'utilities/src/react/hooks'
import { useValueAsRef } from 'utilities/src/react/useValueAsRef'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/shallow'
import {
  LocalizationContext,
  LocalizationContextProvider,
} from 'uniswap/src/features/language/LocalizationContext'
import { logger } from 'utilities/src/logger/logger'

const useCalculatedInitialDerivedSwapInfo = (
  partialSwapFormState: Pick<
    ReturnType<typeof useDefaultSwapFormState>,
    | 'exactAmountFiat'
    | 'exactAmountToken'
    | 'exactCurrencyField'
    | 'focusOnCurrencyField'
    | 'input'
    | 'output'
    | 'selectingCurrencyField'
    | 'txId'
  >,
): DerivedSwapInfo => {
  const {
    debouncedExactAmountToken,
    isDebouncingExactAmountToken,
    debouncedExactAmountFiat,
    isDebouncingExactAmountFiat,
  } = useDebouncedSwapFormAmounts({
    exactCurrencyField: partialSwapFormState.exactCurrencyField,
    exactAmountToken: partialSwapFormState.exactAmountToken,
    exactAmountFiat: partialSwapFormState.exactAmountFiat,
  })

  return useDerivedSwapInfo({
    txId: partialSwapFormState.txId,
    [CurrencyField.INPUT]: partialSwapFormState.input ?? null,
    [CurrencyField.OUTPUT]: partialSwapFormState.output ?? null,
    exactCurrencyField: partialSwapFormState.exactCurrencyField,
    exactAmountToken: debouncedExactAmountToken,
    exactAmountFiat: debouncedExactAmountFiat,
    focusOnCurrencyField: partialSwapFormState.focusOnCurrencyField,
    selectingCurrencyField: partialSwapFormState.selectingCurrencyField,
    isDebouncing: isDebouncingExactAmountToken || isDebouncingExactAmountFiat,
  })
}

// Initializer component: computes initial derived swap info using heavy hook (`useCalculatedInitialDerivedSwapInfo`) once,
// then passes it to the base provider and unmounts
function SwapFormStoreContextProviderInitializer({
  initialState,
  onReady,
}: {
  initialState: SwapFormState
  onReady: (d: DerivedSwapInfo) => void
}): JSX.Element | null {
  const initialDerived = useCalculatedInitialDerivedSwapInfo({
    exactAmountFiat: initialState.exactAmountFiat ?? INITIAL_SWAP_FORM_STATE.exactAmountFiat,
    exactAmountToken: initialState.exactAmountToken ?? INITIAL_SWAP_FORM_STATE.exactAmountToken,
    exactCurrencyField: initialState.exactCurrencyField,
    focusOnCurrencyField: initialState.focusOnCurrencyField ?? INITIAL_SWAP_FORM_STATE.focusOnCurrencyField,
    input: initialState.input ?? INITIAL_SWAP_FORM_STATE.input,
    output: initialState.output ?? INITIAL_SWAP_FORM_STATE.output,
    selectingCurrencyField: initialState.selectingCurrencyField ?? INITIAL_SWAP_FORM_STATE.selectingCurrencyField,
    txId: initialState.txId ?? INITIAL_SWAP_FORM_STATE.txId,
  })

  useEffect(() => {
    onReady(initialDerived)
  }, [initialDerived, onReady])

  return null
}

// Base provider: assumes initialDerivedSwapInfo is provided and creates the store with it
function SwapFormStoreContextProviderBase({
  children,
  hideFooter,
  hideSettings,
  prefilledState,
  initialStateToUse,
  initialDerivedSwapInfo,
}: PropsWithChildren<{
  hideFooter?: boolean
  hideSettings?: boolean
  prefilledState?: SwapFormState
  initialStateToUse: SwapFormState
  initialDerivedSwapInfo: DerivedSwapInfo
}>): JSX.Element {
  // CRITICAL: All hooks must be called unconditionally and in the same order on every render.
  // No early returns before hooks. No conditional hook calls. Dependency arrays must always be arrays.

  // Render signature logging (dev-only, no hooks) to diagnose hook ordering issues
  // CONSOLE-PROBE removed: No longer needed, using boundaryLog for all instrumentation

  // CRITICAL: This logging happens BEFORE any hooks to avoid affecting hook order
  if (process.env.NODE_ENV !== 'production') {
    const chainId = initialDerivedSwapInfo?.chainId
    const renderSignature = {
      chainId,
      hasInput: !!initialDerivedSwapInfo?.currencies?.[CurrencyField.INPUT],
      hasOutput: !!initialDerivedSwapInfo?.currencies?.[CurrencyField.OUTPUT],
      hasTrade: !!initialDerivedSwapInfo?.trade,
      hasOnChainQuote: !!initialDerivedSwapInfo?.onChainQuote,
      hideFooter: !!hideFooter,
      hideSettings: !!hideSettings,
      hasPrefilledState: !!prefilledState,
    }
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[SwapFormStoreContextProviderBase] Render signature',
      renderSignature,
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['SwapFormStore-Render-signature', chainId],
      }
    )
  }

  // Safeguard: ensure localization context is present even if parent tree forgot to wrap.
  const localizationContext = useContext(LocalizationContext)
  const MaybeLocalizationProvider = localizationContext ? Fragment : LocalizationContextProvider

  const dispatch = useDispatch()

  // Create store with default state and prefilled state
  const [{ store, cleanup }] = useState(() =>
    createSwapFormStore({
      hideFooter,
      hideSettings,
      initialState: initialStateToUse,
      derivedSwapInfo: initialDerivedSwapInfo,
      dependenciesForSideEffect: {
        dispatch,
      },
    }),
  )

  // Cleanup store subscriptions on unmount
  useEffect(() => () => cleanup(), [cleanup])

  // Access store state
  const {
    amountUpdatedTimeRef,
    exactAmountFiatRef,
    exactAmountTokenRef,
    exactAmountFiat,
    exactAmountToken,
    exactCurrencyField,
    focusOnCurrencyField,
    input,
    isMax,
    isSelectingCurrencyFieldPrefilled,
    isSubmitting,
    output,
    selectingCurrencyField,
    txId,
  } = useStore(
    store,
    useShallow((s) => ({
      amountUpdatedTimeRef: s.amountUpdatedTimeRef,
      exactAmountFiatRef: s.exactAmountFiatRef,
      exactAmountTokenRef: s.exactAmountTokenRef,
      exactAmountFiat: s.exactAmountFiat,
      exactAmountToken: s.exactAmountToken,
      exactCurrencyField: s.exactCurrencyField,
      focusOnCurrencyField: s.focusOnCurrencyField,
      input: s.input,
      isMax: s.isMax,
      isSelectingCurrencyFieldPrefilled: s.isSelectingCurrencyFieldPrefilled,
      isSubmitting: s.isSubmitting,
      output: s.output,
      selectingCurrencyField: s.selectingCurrencyField,
      txId: s.txId,
      hideFooter,
      hideSettings,
    })),
  )

  // Access store actions
  const { setSwapFormState, setUpdateSwapForm } = useStore(
    store,
    useShallow((s) => s.actions),
  )

  // prefilled state may load in -- i.e. `outputCurrency` URL param pulling from gql
  useUpdateSwapFormFromPrefilledCurrencies({
    prefilledState,
    setSwapForm: setSwapFormState,
  })

  // Enable launching the output token selector through a change to the prefilled state
  useOpenOutputSelectorOnPrefilledStateChange({
    prefilledSelectingCurrencyField: prefilledState?.selectingCurrencyField,
    prefilledFilteredChainIds: prefilledState?.filteredChainIds,
    setSwapForm: setSwapFormState,
  })

  // CRITICAL: All hooks must be called unconditionally, regardless of useOnChainQuote state.
  // useOnChainQuote may flip from true to false after swap submission (e.g., when amounts clear),
  // but this must NOT affect which hooks are called or their order.
  // All branching based on useOnChainQuote must happen INSIDE hook bodies or memo callbacks, not in hook calls themselves.

  // Hook probe utility (dev-only) to diagnose hook order changes
  // CRITICAL: useRef must be called unconditionally, but logging is gated
  const hookProbeH01 = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH01.current += 1
    const chainId = initialDerivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H01: After store hooks',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H01', chainId],
      }
    )
  }

  const latestDerivedSwapInfo = useCalculatedInitialDerivedSwapInfo({
    exactAmountFiat,
    exactAmountToken,
    exactCurrencyField,
    focusOnCurrencyField,
    input,
    output,
    selectingCurrencyField,
    txId,
  })

  const hookProbeH02 = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH02.current += 1
    const chainId = latestDerivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H02: After useCalculatedInitialDerivedSwapInfo',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H02', chainId],
      }
    )
  }

  // This prevents the swap form from displaying a new trade while an old one is still being submitted.
  const derivedSwapInfo = useFreezeWhileSubmitting(latestDerivedSwapInfo, isSubmitting)

  const hookProbeH03 = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH03.current += 1
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H03: After useFreezeWhileSubmitting',
      {
        chainId,
        hasOnChainQuote: !!derivedSwapInfo.onChainQuote,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H03', chainId],
      }
    )
  }

  // Extract values for logging (no hooks, pure data extraction)
  // CRITICAL: inputAmount and inputBalanceAmount must be extracted AFTER all hooks that might affect them
  // These are used in dependency arrays, so they must be stable references
  const inputAmount = derivedSwapInfo.currencyAmounts[CurrencyField.INPUT] ?? null
  const inputBalanceAmount = derivedSwapInfo.currencyBalances[CurrencyField.INPUT] ?? null

  // Hook probe before useSwapAnalytics (dev-only)
  const hookProbeH03b = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH03b.current += 1
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H03b: before useSwapAnalytics',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H03b', chainId],
      }
    )
  }

  // All hooks called unconditionally - no branching on useOnChainQuote
  useSwapAnalytics(derivedSwapInfo)

  // Hook probe after useSwapAnalytics (dev-only)
  const hookProbeH03c = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH03c.current += 1
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H03c: after useSwapAnalytics',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H03c', chainId],
      }
    )
  }

  // Hook probe before useMaxAmountSpend/useValueAsRef (dev-only)
  const hookProbeH03d = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH03d.current += 1
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H03d: before useValueAsRef',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H03d', chainId],
      }
    )
  }

  // for native transfers, this is the balance - (estimated gas fee for one transaction * multiplier from flag);
  // for ERC20 transfers, this is the balance
  // CRITICAL: useMaxAmountSpend is always called, regardless of useOnChainQuote state
  // CRITICAL: inputBalanceAmount is normalized to null (never undefined) to ensure stable dependency arrays
  // CRITICAL: useValueAsRef must be called unconditionally - pass null if value is missing
  const maxAmountSpendResult = useMaxAmountSpend({
    currencyAmount: inputBalanceAmount ?? undefined,
    txType: TransactionType.Swap,
    isExtraTx: true,
  })
  // CRITICAL: Always call useValueAsRef, even if maxAmountSpendResult is undefined
  // Normalize to null to ensure stable ref value
  const maxInputAmountAsRef = useValueAsRef(maxAmountSpendResult?.toExact() ?? null)

  // Hook probe after useValueAsRef (dev-only)
  const hookProbeH03e = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH03e.current += 1
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H03e: after useValueAsRef',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H03e', chainId],
      }
    )
  }

  // CRITICAL: Dependency array must always be a stable array with consistent length.
  // All values are normalized to null instead of undefined to ensure stable array shape.
  // inputAmount is normalized to null (never undefined) to prevent dependency array shape changes.
  const maybeUpdatedIsMax = useMemo((): boolean => {
    // exact-input-field forms are handled in `updateSwapForm()`
    const inputAmountString = inputAmount?.toExact?.() ?? null

    if (
      derivedSwapInfo.exactCurrencyField === CurrencyField.OUTPUT &&
      inputAmountString &&
      maxInputAmountAsRef.current
    ) {
      const isMaxThreshold = !!(parseFloat(inputAmountString) >= parseFloat(maxInputAmountAsRef.current))

      // do not rerender if isMax is unchanged
      if (isMaxThreshold !== isMax) {
        return isMaxThreshold
      }
    }

    return isMax
  }, [
    derivedSwapInfo.exactCurrencyField,
    inputAmount, // Normalized to null, never undefined
    isMax,
    // maxInputAmountAsRef is a ref (stable), read via .current inside memo body
  ])

  const hookProbeH06 = useRef(0)
  if (process.env.NODE_ENV !== 'production') {
    hookProbeH06.current += 1
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapFormStoreContextProvider',
      'SwapFormStoreContextProviderBase',
      '[HookProbe] H06: After maybeUpdatedIsMax useMemo',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['H06', chainId],
      }
    )
  }

  // Create `updateSwapForm` function, to be set, once, in the store
  const updateSwapForm = useEvent((newState: Partial<SwapFormState>): void => {
    const updatedState = { ...newState }

    const isAmountUpdated = updatedState.exactAmountFiat !== undefined || updatedState.exactAmountToken !== undefined

    if (isAmountUpdated) {
      amountUpdatedTimeRef.current = Date.now()
    }

    if (updatedState.exactAmountFiat !== undefined) {
      exactAmountFiatRef.current = updatedState.exactAmountFiat
    }

    if (updatedState.exactAmountToken !== undefined) {
      exactAmountTokenRef.current = updatedState.exactAmountToken
    }

    if (isAmountUpdated || updatedState.exactCurrencyField !== CurrencyField.OUTPUT) {
      const isMaxTokenAmount =
        !!maxInputAmountAsRef.current &&
        !!updatedState.exactAmountToken &&
        parseFloat(maxInputAmountAsRef.current) <= parseFloat(updatedState.exactAmountToken)

      // if max value is explicitly set, use that
      // otherwise, check the token amount again the maxInputAmount
      updatedState.isMax = updatedState.isMax ?? isMaxTokenAmount
    }

    setSwapFormState(updatedState)
  })

  // Set `updateSwapForm` function in the store
  useEffect(() => {
    setUpdateSwapForm(updateSwapForm)
    // These are fine as they're both referentially stable
  }, [setUpdateSwapForm, updateSwapForm])

  // CRITICAL: Normalize to null to ensure stable dependency array
  const prefilledCurrencies = useMemo(
    () => [prefilledState?.input, prefilledState?.output].filter((asset): asset is TradeableAsset => Boolean(asset)),
    [prefilledState?.input ?? null, prefilledState?.output ?? null],
  )

  const derivedState: Partial<SwapFormStateForConsumers> = useMemo(
    () => ({
      derivedSwapInfo,
      hideFooter,
      hideSettings,
      prefilledCurrencies,
      isSelectingCurrencyFieldPrefilled,
      isMax: maybeUpdatedIsMax,
    }),
    [
      derivedSwapInfo,
      hideFooter,
      hideSettings,
      prefilledCurrencies,
      isSelectingCurrencyFieldPrefilled,
      maybeUpdatedIsMax,
    ],
  )

  // Sync derived state to the store
  // We do want it to run on every render, including the first, as the store is not initialized with this derived state
  useEffect(() => {
    setSwapFormState(derivedState)
  }, [derivedState, setSwapFormState])

  return (
    <MaybeLocalizationProvider>
      <SwapFormStoreContext.Provider value={store}>{children}</SwapFormStoreContext.Provider>
    </MaybeLocalizationProvider>
  )
}

// Orchestrator: computes initial state, bootstraps initial derived swap info, then renders the base provider
export const SwapFormStoreContextProvider = ({
  children,
  hideFooter,
  hideSettings,
  prefilledState,
}: PropsWithChildren<{
  hideFooter?: boolean
  hideSettings?: boolean
  prefilledState?: SwapFormState
}>): JSX.Element => {
  // Ensure localization context is present; if missing (e.g., tests or embedded usage),
  // inject the provider locally. Upstream behavior unchanged when parent already wraps.
  const localizationContext = useContext(LocalizationContext)
  const MaybeLocalizationProvider = localizationContext ? Fragment : LocalizationContextProvider

  // Get default state for store initialization
  const defaultState = useDefaultSwapFormState()

  const initialStateToUse = useMemo(() => {
    return prefilledState ?? defaultState
  }, [prefilledState, defaultState])

  const [initialDerivedSwapInfo, setInitialDerivedSwapInfo] = useState<DerivedSwapInfo | null>(null)

  if (!initialDerivedSwapInfo) {
    return (
      <MaybeLocalizationProvider>
        <SwapFormStoreContextProviderInitializer
          initialState={initialStateToUse}
          onReady={setInitialDerivedSwapInfo}
        />
      </MaybeLocalizationProvider>
    )
  }

  return (
    <MaybeLocalizationProvider>
      <SwapFormStoreContextProviderBase
        hideFooter={hideFooter}
        hideSettings={hideSettings}
        prefilledState={prefilledState}
        initialStateToUse={initialStateToUse}
        initialDerivedSwapInfo={initialDerivedSwapInfo}
      >
        {children}
      </SwapFormStoreContextProviderBase>
    </MaybeLocalizationProvider>
  )
}
