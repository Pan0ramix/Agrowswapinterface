import { Percent, TradeType } from '@uniswap/sdk-core'
import { FeeAmount, Route } from '@uniswap/v3-sdk'
import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { useMemo } from 'react'
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
import { useV3OnChainSwapQuote } from 'uniswap/src/features/transactions/swap/hooks/useV3OnChainSwapQuote'
import { shouldUseV3OnChainQuote } from 'uniswap/src/features/transactions/swap/utils/v3OnChainTradeAdapter'
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

  // Determine if we should use on-chain quotes (for Base Sepolia single-pool V3 swaps)
  const useOnChainQuote = useMemo(() => {
    return (
      isExactIn &&
      shouldUseV3OnChainQuote({
        chainId: chainId as number | undefined,
        tokenIn: currencyIn,
        tokenOut: currencyOut,
        amountIn: amountSpecified,
      })
    )
  }, [isExactIn, chainId, currencyIn, currencyOut, amountSpecified])

  // Get slippage tolerance
  const slippageTolerance = useMemo(() => {
    if (customSlippageTolerance !== undefined) {
      return new Percent(customSlippageTolerance * 100, 10000)
    }
    return new Percent(50, 10000) // Default 0.5%
  }, [customSlippageTolerance])

  // Use on-chain quote for eligible swaps
  const onChainQuote = useV3OnChainSwapQuote({
    tokenIn: currencyIn,
    tokenOut: currencyOut,
    amountIn: amountSpecified,
    fee: FeeAmount.MEDIUM, // TODO: Determine fee from pool or user selection
    slippageTolerance,
    chainId: chainId as EVMUniverseChainId | undefined,
    recipient: account?.address,
    enabled: useOnChainQuote && !!amountSpecified && !!currencyIn && !!currencyOut,
  })

  // Use existing Trading API trade hook (skip if using on-chain)
  const trade = useTrade({
    account,
    amountSpecified,
    otherCurrency,
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
    // If we have a successful on-chain quote, create a trade-like object
    if (useOnChainQuote && onChainQuote.txPayload && onChainQuote.quoteAmountOut && onChainQuote.pool) {
      // Create a Route from the pool
      const route = new Route([onChainQuote.pool], currencyIn!, currencyOut!)

      // Create execution price
      const executionPrice = onChainQuote.quoteAmountOut.divide(amountSpecified!)

      // Return a trade-like object that works with existing UI
      return {
        ...trade,
        trade: {
          inputAmount: amountSpecified!,
          outputAmount: onChainQuote.quoteAmountOut,
          executionPrice,
          priceImpact: onChainQuote.priceImpact,
          route,
          // Store on-chain data for transaction building
          onChainTxPayload: onChainQuote.txPayload,
          onChainPool: onChainQuote.pool,
        } as any, // Type assertion needed for compatibility
        isLoading: onChainQuote.isLoading,
        isFetching: onChainQuote.isLoading,
        error: onChainQuote.error,
      }
    }

    // Otherwise, use the regular trade
    return trade
  }, [
    useOnChainQuote,
    onChainQuote.txPayload,
    onChainQuote.quoteAmountOut,
    onChainQuote.pool,
    onChainQuote.isLoading,
    onChainQuote.error,
    onChainQuote.priceImpact,
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
      onChainQuote: useOnChainQuote && onChainQuote.txPayload ? onChainQuote : undefined,
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
