import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useFeeOnTransferAmounts } from 'uniswap/src/features/transactions/swap/hooks/useFeeOnTransferAmount'
import { useParsedSwapWarnings } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/useSwapWarnings'
import type { SwapReviewTransactionState } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewTransactionStore/createSwapReviewTransactionStore'
import { createSwapReviewTransactionStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewTransactionStore/createSwapReviewTransactionStore'
import { SwapReviewTransactionStoreContext } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewTransactionStore/SwapReviewTransactionStoreContext'
import { isClassic, isUniswapX } from 'uniswap/src/features/transactions/swap/utils/routing'
import { isWrapAction } from 'uniswap/src/features/transactions/swap/utils/wrap'
import { getRelevantTokenWarningSeverity } from 'uniswap/src/features/transactions/TransactionDetails/utils/getRelevantTokenWarningSeverity'
import { CurrencyField } from 'uniswap/src/types/currency'
import { useHasValueChanged } from 'utilities/src/react/useHasValueChanged'
import { logger } from 'utilities/src/logger/logger'

export const SwapReviewTransactionStoreContextProvider = ({
  children,
  derivedSwapInfo,
  swapTxContext,
  acceptedDerivedSwapInfo,
  newTradeRequiresAcceptance,
}: PropsWithChildren<
  Pick<
    SwapReviewTransactionState,
    'derivedSwapInfo' | 'swapTxContext' | 'acceptedDerivedSwapInfo' | 'newTradeRequiresAcceptance'
  >
>): JSX.Element => {
  const uniswapXGasBreakdown = isUniswapX(swapTxContext) ? swapTxContext.gasFeeBreakdown : undefined

  const {
    chainId,
    currencies,
    wrapType,
    trade: { trade, indicativeTrade }, // TODO(WEB-5823): rm indicative trade usage from review screen
  } = derivedSwapInfo

  const { blockingWarning, reviewScreenWarning } = useParsedSwapWarnings()
  const isWrap = isWrapAction(wrapType)
  const acceptedTrade = acceptedDerivedSwapInfo?.trade.trade
  const feeOnTransferProps = useFeeOnTransferAmounts(acceptedDerivedSwapInfo)
  const tokenWarningProps = getRelevantTokenWarningSeverity(acceptedDerivedSwapInfo)

  // Check if we have Trading API quote (on-chain-only trades have quote: undefined)
  const hasApiQuote = useMemo(() => {
    return !!trade?.quote?.quote
  }, [trade])

  const txSimulationErrors = useMemo(() => {
    if (!trade || !isClassic(trade)) {
      return undefined
    }
    // On-chain-only trades (chainId 84532) have quote: undefined
    // Return undefined when API quote is not available (on-chain-only mode)
    return hasApiQuote ? trade.quote?.quote?.txFailureReasons : undefined
  }, [trade, hasApiQuote])

  // Dev-only shape logging to verify trade object structure (on-chain-only chains)
  if (process.env.NODE_ENV !== 'production' && chainId === 84532 && trade) {
    const shape = (x: any) => ({
      t: typeof x,
      ctor: x?.constructor?.name,
      hasEqualTo: typeof x?.equalTo === 'function',
      hasQuotient: x?.quotient != null,
      hasCurrency: x?.currency != null,
      hasToExact: typeof x?.toExact === 'function',
    })
    // Check if swapTxContext has txRequests (only Classic/Wrap/Bridge/Chained have it)
    const hasTxRequests = isClassic(swapTxContext) || isWrapAction(wrapType)
      ? !!(swapTxContext as any).txRequests
      : false
    const txRequestsLength = hasTxRequests ? (swapTxContext as any).txRequests?.length ?? 0 : 0

    const routing = (trade as any).routing
    logger.debugDeduped(
      'SwapReviewTransactionStore',
      'Trade shape (on-chain-only)',
      'Trade structure',
      {
        chainId,
        hasTrade: !!trade,
        hasQuote: !!trade.quote,
        hasApiQuote,
        hasQuoteQuote: !!trade.quote?.quote,
        routing,
        hasTxRequests,
        txRequestsLength: txRequestsLength ?? 0,
      },
      {
        ttlMs: 4000,
        minIntervalMs: 2000,
        maxPerWindow: 1,
        windowMs: 4000,
        includeKeys: ['chainId', 'hasTrade', 'hasQuote', 'hasApiQuote', 'hasQuoteQuote', 'routing'],
      }
    )
  }

  const derivedUpdatedState: SwapReviewTransactionState = useMemo(
    () => ({
      trade: trade ?? undefined,
      indicativeTrade: indicativeTrade ?? undefined,
      acceptedTrade: acceptedTrade ?? undefined,
      swapTxContext,
      gasFee: swapTxContext.gasFee,
      uniswapXGasBreakdown,
      derivedSwapInfo,
      acceptedDerivedSwapInfo,
      isWrap,
      blockingWarning,
      reviewScreenWarning,
      txSimulationErrors,
      newTradeRequiresAcceptance,
      feeOnTransferProps,
      tokenWarningProps,
      currencyInInfo: currencies[CurrencyField.INPUT],
      currencyOutInfo: currencies[CurrencyField.OUTPUT],
      chainId,
    }),
    [
      trade,
      indicativeTrade,
      acceptedTrade,
      swapTxContext,
      uniswapXGasBreakdown,
      derivedSwapInfo,
      acceptedDerivedSwapInfo,
      isWrap,
      blockingWarning,
      reviewScreenWarning,
      txSimulationErrors,
      newTradeRequiresAcceptance,
      feeOnTransferProps,
      tokenWarningProps,
      currencies,
      chainId,
    ],
  )

  const [store] = useState(() => createSwapReviewTransactionStore(derivedUpdatedState))

  const hasDerivedStateChanged = useHasValueChanged(derivedUpdatedState)

  useEffect(() => {
    if (hasDerivedStateChanged) {
      store.setState(derivedUpdatedState)
    }
  }, [derivedUpdatedState, store, hasDerivedStateChanged])

  return (
    <SwapReviewTransactionStoreContext.Provider value={store}>{children}</SwapReviewTransactionStoreContext.Provider>
  )
}
