import { Percent, TradeType } from '@uniswap/sdk-core'
import { FeeAmount, Route } from '@uniswap/v3-sdk'
import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { useEffect, useMemo, useRef } from 'react'
import JSBI from 'jsbi'
import { useUniswapContextSelector } from 'uniswap/src/contexts/UniswapContext'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { EVMUniverseChainId, UniverseChainId } from 'uniswap/src/features/chains/types'
import { useOnChainCurrencyBalance } from 'uniswap/src/features/portfolio/api'
import { getCurrencyAmount, ValueType } from 'uniswap/src/features/tokens/getCurrencyAmount'
import { useCurrencyInfo } from 'uniswap/src/features/tokens/useCurrencyInfo'
import { useTransactionSettingsStore } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { useUSDCValue } from 'uniswap/src/features/transactions/hooks/useUSDCPrice'
import { usePriceUXEnabled } from 'uniswap/src/features/transactions/swap/hooks/usePriceUXEnabled'
import { useTrade } from 'uniswap/src/features/transactions/swap/hooks/useTrade'
import { useOnChainSwapQuote } from 'uniswap/src/features/transactions/swap/hooks/useOnChainSwapQuote'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { logger } from 'utilities/src/logger/logger'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import { getWrapType } from 'uniswap/src/features/transactions/swap/utils/wrap'
import type { TransactionState } from 'uniswap/src/features/transactions/types/transactionState'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { CurrencyField } from 'uniswap/src/types/currency'
import { buildCurrencyId } from 'uniswap/src/utils/currencyId'

/** Returns information derived from the current swap state */
export function useDerivedSwapInfo({
  isDebouncing,
  ...state
}: TransactionState & { isDebouncing?: boolean }): DerivedSwapInfo {
  const {
    [CurrencyField.INPUT]: currencyAssetIn,
    [CurrencyField.OUTPUT]: currencyAssetOut,
    exactAmountFiat,
    exactAmountToken,
    exactCurrencyField,
    focusOnCurrencyField = CurrencyField.INPUT,
    selectingCurrencyField,
    txId,
  } = state

  const { defaultChainId } = useEnabledChains()

  const { customSlippageTolerance, selectedProtocols, isV4HookPoolsEnabled } = useTransactionSettingsStore((s) => ({
    customSlippageTolerance: s.customSlippageTolerance,
    selectedProtocols: s.selectedProtocols,
    isV4HookPoolsEnabled: s.isV4HookPoolsEnabled,
  }))

  const currencyInInfo = useCurrencyInfo(
    currencyAssetIn ? buildCurrencyId(currencyAssetIn.chainId, currencyAssetIn.address) : undefined,
    { refetch: true },
  )

  const currencyOutInfo = useCurrencyInfo(
    currencyAssetOut ? buildCurrencyId(currencyAssetOut.chainId, currencyAssetOut.address) : undefined,
    { refetch: true },
  )

  const currencyIn = currencyInInfo?.currency
  const currencyOut = currencyOutInfo?.currency

  const chainId = currencyIn?.chainId ?? currencyOut?.chainId ?? defaultChainId

  const { evmAccount, svmAccount } = useWallet()

  const account = chainId === UniverseChainId.Solana ? svmAccount : evmAccount

  const currencies = useMemo(() => {
    return {
      [CurrencyField.INPUT]: currencyInInfo,
      [CurrencyField.OUTPUT]: currencyOutInfo,
    }
  }, [currencyInInfo, currencyOutInfo])

  const { balance: tokenInBalance } = useOnChainCurrencyBalance(currencyIn, account?.address)
  const { balance: tokenOutBalance } = useOnChainCurrencyBalance(currencyOut, account?.address)

  const isExactIn = exactCurrencyField === CurrencyField.INPUT
  const wrapType = getWrapType(currencyIn, currencyOut)

  const otherCurrency = isExactIn ? currencyOut : currencyIn
  const exactCurrency = isExactIn ? currencyIn : currencyOut

  // amountSpecified, otherCurrency, tradeType fully defines a trade
  const amountSpecified = useMemo(() => {
    return getCurrencyAmount({
      value: exactAmountToken,
      valueType: ValueType.Exact,
      currency: exactCurrency,
    })
  }, [exactAmountToken, exactCurrency])

  const sendPortionEnabled = useFeatureFlag(FeatureFlags.PortionFields)

  const generatePermitAsTransaction = useUniswapContextSelector((ctx) => {
    // If the account cannot sign typedData, permits should be completed as a transaction step,
    // unless the swap is going through the 7702 smart wallet flow, in which case the
    // swap_7702 endpoint consumes typedData in the process encoding the swap.
    return ctx.getCanSignPermits?.(chainId) && !ctx.getSwapDelegationInfo?.(chainId).delegationAddress
  })

  // Determine if we should use on-chain quotes (for Base Sepolia, Base, Polygon)
  // Use isOnChainRouterEnabled to check if the chain supports on-chain routing
  const useOnChainQuote = useMemo(() => {
    if (!chainId || !isExactIn || !currencyIn || !currencyOut || !amountSpecified) {
      return false
    }
    // Check if on-chain router is enabled for this chain
    return isOnChainRouterEnabled(chainId as number)
  }, [isExactIn, chainId, currencyIn, currencyOut, amountSpecified])

  // Debug: track the parsed amount we will pass to the on-chain router (Base Sepolia only, non-prod)
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' &&
      chainId === UniverseChainId.BaseSepolia &&
      useOnChainQuote &&
      amountSpecified
    ) {
      logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'On-chain amountSpecified parsed', {
        chainId,
        isExactIn,
        exactAmountToken,
        amountSpecifiedRaw: amountSpecified.quotient.toString(),
        amountSpecifiedExact: amountSpecified.toExact(),
        tokenIn: currencyIn?.symbol,
        tokenOut: currencyOut?.symbol,
      })
    }
  }, [chainId, useOnChainQuote, amountSpecified, exactAmountToken, isExactIn, currencyIn, currencyOut])

  // Get slippage tolerance
  const slippageTolerance = useMemo(() => {
    if (customSlippageTolerance !== undefined) {
      return new Percent(customSlippageTolerance * 100, 10000)
    }
    return new Percent(50, 10000) // Default 0.5%
  }, [customSlippageTolerance])

  // Use on-chain quote for eligible swaps
  // This hook uses the full on-chain router (findRoute, QuoterV2, etc.)
  const onChainQuote = useOnChainSwapQuote({
    tokenIn: currencyIn,
    tokenOut: currencyOut,
    amountIn: amountSpecified ?? undefined,
    slippageTolerance,
    chainId: chainId as EVMUniverseChainId | undefined,
    recipient: account?.address,
    enabled:
      useOnChainQuote &&
      !!amountSpecified &&
      JSBI.greaterThan(amountSpecified.quotient, JSBI.BigInt(0)) &&
      !!currencyIn &&
      !!currencyOut,
  })

  // Use existing Trading API trade hook (disabled when using on-chain)
  // When on-chain is enabled, we skip the Trading API entirely
  // Development debug (deduped) if Trading API would be called for on-chain enabled chain
  const lastWarnedChainIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' &&
      useOnChainQuote &&
      account &&
      amountSpecified &&
      otherCurrency &&
      chainId &&
      lastWarnedChainIdRef.current !== chainId
    ) {
      logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'Trading API disabled for on-chain chain', {
        chainId,
      })
      lastWarnedChainIdRef.current = chainId
    }
  }, [useOnChainQuote, account, amountSpecified, otherCurrency, chainId])

  const trade = useTrade({
    account: useOnChainQuote ? undefined : account, // Disable by passing undefined account
    amountSpecified: useOnChainQuote ? undefined : amountSpecified, // Disable by passing undefined amount
    otherCurrency: useOnChainQuote ? undefined : otherCurrency, // Disable by passing undefined currency
    tradeType: isExactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
    customSlippageTolerance,
    selectedProtocols,
    sendPortionEnabled,
    isDebouncing,
    generatePermitAsTransaction,
    isV4HookPoolsEnabled,
  })

  // Merge on-chain quote with trade results
  const mergedTrade = useMemo(() => {
    // If we have a successful on-chain quote, use it instead of Trading API trade
    if (useOnChainQuote && onChainQuote.data) {
      const { quoteAmountOut, txPayload, route: routeResult, priceImpact } = onChainQuote.data

      if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
        logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'Using on-chain quote', {
          chainId,
          amountInRaw: amountSpecified?.quotient.toString(),
          amountInExact: amountSpecified?.toExact(),
          amountOutRaw: quoteAmountOut.quotient.toString(),
          amountOutExact: quoteAmountOut.toExact(),
          routeDescription: routeResult.route?.description,
          hops: (routeResult.route?.hops ?? []).map((h) => ({
            tokenIn: h.tokenIn.symbol,
            tokenOut: h.tokenOut.symbol,
            fee: h.fee,
          })),
          txTo: txPayload.to,
          txValue: txPayload.value,
          txDataLen: txPayload.data?.length,
          txGasLimit: txPayload.gasLimit,
        })
      }

      // Create execution price
      const executionPrice = quoteAmountOut.divide(amountSpecified!)

      // Build Route object from ValidatedRoute
      // Note: ValidatedRoute contains route.hops which we'd need to convert to pools
      // For now, we'll create a minimal trade object without the Route
      // The UI should work with just inputAmount, outputAmount, and executionPrice
      const priceImpactPercent = priceImpact !== undefined 
        ? new Percent(Math.round(priceImpact * 10000), 10000) 
        : new Percent(0, 100)

      // Return a trade-like object that works with existing UI
      return {
        ...trade,
        // Expose full on-chain quote for downstream tx builder
        onChainQuote: onChainQuote.data,
        trade: {
          inputAmount: amountSpecified!,
          outputAmount: quoteAmountOut,
          executionPrice,
          priceImpact: priceImpactPercent,
          // Route is optional - UI can work without it for on-chain quotes
          route: undefined,
          // Store on-chain data for transaction building
          onChainTxPayload: txPayload,
          onChainRoute: routeResult,
        } as any, // Type assertion needed for compatibility
        isLoading: onChainQuote.isLoading,
        isFetching: onChainQuote.isLoading,
        error: onChainQuote.error,
      }
    }

    // Otherwise, use the regular trade (Trading API or no trade)
    // When on-chain is enabled but quote failed, still show error from on-chain hook
    if (useOnChainQuote && onChainQuote.isError) {
      if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
        logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'On-chain quote errored', {
          chainId,
          error: onChainQuote.error?.message,
        })
      }
      return {
        ...trade,
        isLoading: onChainQuote.isLoading,
        isFetching: onChainQuote.isLoading,
        error: onChainQuote.error,
      }
    }

    // Debug when no on-chain quote is adopted
    if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
      logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'On-chain quote not used', {
        chainId,
        useOnChainQuote,
        hasOnChainQuoteData: !!onChainQuote.data,
        isOnChainQuoteLoading: onChainQuote.isLoading,
        isOnChainQuoteError: onChainQuote.isError,
      })
    }

    return trade
  }, [
    useOnChainQuote,
    onChainQuote.data,
    onChainQuote.isLoading,
    onChainQuote.isError,
    onChainQuote.error,
    currencyIn,
    currencyOut,
    amountSpecified,
    trade,
  ])

  const displayableTrade = mergedTrade.trade ?? mergedTrade.indicativeTrade

  const priceUXEnabled = usePriceUXEnabled()
  const displayableTradeOutputAmount = priceUXEnabled
    ? displayableTrade?.quoteOutputAmount
    : displayableTrade?.outputAmount

  const currencyAmounts = useMemo(
    () => ({
      [CurrencyField.INPUT]:
        exactCurrencyField === CurrencyField.INPUT ? amountSpecified : displayableTrade?.inputAmount,
      [CurrencyField.OUTPUT]:
        exactCurrencyField === CurrencyField.OUTPUT ? amountSpecified : displayableTradeOutputAmount,
    }),
    [exactCurrencyField, amountSpecified, displayableTrade?.inputAmount, displayableTradeOutputAmount],
  )

  const inputCurrencyUSDValue = useUSDCValue(currencyAmounts[CurrencyField.INPUT])
  const outputCurrencyUSDValue = useUSDCValue(currencyAmounts[CurrencyField.OUTPUT])

  const currencyAmountsUSDValue = useMemo(() => {
    return {
      [CurrencyField.INPUT]: inputCurrencyUSDValue,
      [CurrencyField.OUTPUT]: outputCurrencyUSDValue,
    }
  }, [inputCurrencyUSDValue, outputCurrencyUSDValue])

  const currencyBalances = useMemo(() => {
    return {
      [CurrencyField.INPUT]: tokenInBalance,
      [CurrencyField.OUTPUT]: tokenOutBalance,
    }
  }, [tokenInBalance, tokenOutBalance])

  return useMemo(() => {
    return {
      chainId,
      currencies,
      currencyAmounts,
      currencyAmountsUSDValue,
      currencyBalances,
      trade: mergedTrade,
      exactAmountToken,
      exactAmountFiat,
      exactCurrencyField,
      focusOnCurrencyField,
      wrapType,
      selectingCurrencyField,
      txId,
      outputAmountUserWillReceive: displayableTrade?.quoteOutputAmountUserWillReceive,
      // Store on-chain quote data for transaction building
      onChainQuote: useOnChainQuote && onChainQuote.data ? onChainQuote.data : undefined,
    }
  }, [
    chainId,
    currencies,
    currencyAmounts,
    currencyAmountsUSDValue,
    currencyBalances,
    exactAmountFiat,
    exactAmountToken,
    exactCurrencyField,
    focusOnCurrencyField,
    selectingCurrencyField,
    mergedTrade,
    txId,
    wrapType,
    displayableTrade,
    useOnChainQuote,
    onChainQuote,
  ])
}
