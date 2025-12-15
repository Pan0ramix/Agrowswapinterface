import { Currency, CurrencyAmount, Percent, Price, TradeType } from '@uniswap/sdk-core'
import { ClassicQuoteResponse, TradingApi } from '@universe/api'
import { FeeAmount, Route } from '@uniswap/v3-sdk'
import { FeatureFlags } from '@universe/gating'
import { useEffect, useMemo, useRef } from 'react'
import { useFeatureFlagSafe } from 'uniswap/src/features/experiments/useDynamicConfigValueSafe'
import JSBI from 'jsbi'
import { useUniswapContextSelector } from 'uniswap/src/contexts/UniswapContext'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { EVMUniverseChainId, UniverseChainId } from 'uniswap/src/features/chains/types'
import { useOnChainCurrencyBalance } from 'uniswap/src/features/portfolio/api'
import { getCurrencyAmount, ValueType } from 'uniswap/src/features/tokens/getCurrencyAmount'
import { useCurrencyInfo, useCurrencyInfoWithLoading } from 'uniswap/src/features/tokens/useCurrencyInfo'
import { getCachedCurrencyInfo } from 'uniswap/src/features/transactions/swap/form/hooks/useOnSelectCurrency'
import { useTransactionSettingsStore } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { useUSDCValue } from 'uniswap/src/features/transactions/hooks/useUSDCPrice'
import { usePriceUXEnabled } from 'uniswap/src/features/transactions/swap/hooks/usePriceUXEnabled'
import { useTrade } from 'uniswap/src/features/transactions/swap/hooks/useTrade'
import { useOnChainSwapQuote } from 'uniswap/src/features/transactions/swap/hooks/useOnChainSwapQuote'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { logger } from 'utilities/src/logger/logger'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import { getWrapType } from 'uniswap/src/features/transactions/swap/utils/wrap'
import type { TransactionState } from 'uniswap/src/features/transactions/types/transactionState'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { CurrencyField } from 'uniswap/src/types/currency'
import { buildCurrencyId } from 'uniswap/src/utils/currencyId'

/**
 * Builds a minimal ClassicQuoteResponse adapter from on-chain quote data
 * This satisfies upstream invariants (requestId, quote.quoteId) without requiring Trading API
 */
function buildOnChainQuoteAdapter(
  onChainQuote: {
    quoteAmountIn?: CurrencyAmount<Currency>
    quoteAmountOut?: CurrencyAmount<Currency>
    txPayload?: { to?: string; data?: string; value?: string | bigint; gasLimit?: string | bigint } | null
    route?: any | null
  },
  chainId: number | undefined,
  amountRaw: string | undefined,
  isExactIn: boolean,
): ClassicQuoteResponse {
  // Generate deterministic requestId from on-chain quote data
  const quoteAmount = isExactIn ? onChainQuote.quoteAmountOut : onChainQuote.quoteAmountIn
  const requestId = `onchain:${chainId ?? 'unknown'}:${Date.now()}:${amountRaw ?? '0'}:${quoteAmount?.quotient?.toString() ?? '0'}`

  // Create minimal quote adapter that satisfies upstream expectations
  return {
    routing: TradingApi.Routing.CLASSIC,
    requestId,
    quote: {
      quoteId: requestId, // Use requestId as quoteId for on-chain quotes
      blockNumber: undefined, // On-chain quotes don't have block numbers
      slippageTolerance: undefined,
      gasFeeUSD: undefined,
      txFailureReasons: undefined,
      // Include minimal fields that might be accessed
      expectedAmountIn: isExactIn ? amountRaw : (quoteAmount?.quotient?.toString() ?? amountRaw),
      expectedAmountOut: isExactIn ? (quoteAmount?.quotient?.toString() ?? amountRaw) : amountRaw,
    },
  } as ClassicQuoteResponse
}
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

  // Use useCurrencyInfoWithLoading to check loading state and errors for fallback
  const currencyInInfoQuery = useCurrencyInfoWithLoading(
    currencyAssetIn ? buildCurrencyId(currencyAssetIn.chainId, currencyAssetIn.address) : undefined,
    { refetch: true },
  )

  const currencyOutInfoQuery = useCurrencyInfoWithLoading(
    currencyAssetOut ? buildCurrencyId(currencyAssetOut.chainId, currencyAssetOut.address) : undefined,
    { refetch: true },
  )

  // Fallback: If GraphQL doesn't have the token, use cached CurrencyInfo from token selection
  // This ensures tokens appear immediately even if they're not in GraphQL database
  const currencyInId = currencyAssetIn ? buildCurrencyId(currencyAssetIn.chainId, currencyAssetIn.address) : undefined
  const currencyOutId = currencyAssetOut ? buildCurrencyId(currencyAssetOut.chainId, currencyAssetOut.address) : undefined
  
  const cachedCurrencyInInfo = currencyInId ? getCachedCurrencyInfo(currencyInId) : undefined
  const cachedCurrencyOutInfo = currencyOutId ? getCachedCurrencyInfo(currencyOutId) : undefined

  // Use GraphQL result if available, otherwise fall back to cached CurrencyInfo from selection
  const currencyInInfo = currencyInInfoQuery.currencyInfo ?? cachedCurrencyInInfo
  const currencyOutInfo = currencyOutInfoQuery.currencyInfo ?? cachedCurrencyOutInfo

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

  // Use safe wrapper to avoid Statsig hook ordering issues
  const sendPortionEnabled = useFeatureFlagSafe(FeatureFlags.PortionFields)

  const generatePermitAsTransaction = useUniswapContextSelector((ctx) => {
    // If the account cannot sign typedData, permits should be completed as a transaction step,
    // unless the swap is going through the 7702 smart wallet flow, in which case the
    // swap_7702 endpoint consumes typedData in the process encoding the swap.
    return ctx.getCanSignPermits?.(chainId) && !ctx.getSwapDelegationInfo?.(chainId).delegationAddress
  })

  // Determine if we should use on-chain quotes (for Base Sepolia, Base, Polygon)
  // Use isOnChainRouterEnabled to check if the chain supports on-chain routing
  // Supports both exact input and exact output
  const useOnChainQuote = useMemo(() => {
    if (!chainId || !currencyIn || !currencyOut || !amountSpecified) {
      return false
    }
    // Check if on-chain router is enabled for this chain
    return isOnChainRouterEnabled(chainId as number)
  }, [chainId, currencyIn, currencyOut, amountSpecified])

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
        amountSpecifiedRaw: amountSpecified?.quotient?.toString(),
        amountSpecifiedExact: amountSpecified?.toExact(),
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
  // Supports both exact input and exact output
  const onChainQuoteEnabled = useMemo(() => {
    const enabled = useOnChainQuote &&
      !!amountSpecified &&
      JSBI.greaterThan(amountSpecified.quotient, JSBI.BigInt(0)) &&
      !!currencyIn &&
      !!currencyOut
    
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'On-chain quote enabled check', {
        chainId,
        enabled,
        useOnChainQuote,
        hasAmountSpecified: !!amountSpecified,
        amountSpecifiedRaw: amountSpecified?.quotient?.toString(),
        hasCurrencyIn: !!currencyIn,
        hasCurrencyOut: !!currencyOut,
        isExactIn,
        tokenIn: currencyIn?.symbol,
        tokenOut: currencyOut?.symbol,
        hasRecipient: !!account?.address,
      })
    }
    
    return enabled
  }, [useOnChainQuote, amountSpecified, currencyIn, currencyOut, isExactIn, account?.address, chainId])
  
  const onChainQuote = useOnChainSwapQuote({
    tokenIn: currencyIn,
    tokenOut: currencyOut,
    amountIn: isExactIn ? amountSpecified ?? undefined : undefined,
    amountOut: !isExactIn ? amountSpecified ?? undefined : undefined,
    slippageTolerance,
    chainId: chainId as EVMUniverseChainId | undefined,
    recipient: account?.address,
    enabled: onChainQuoteEnabled,
  })
  
  // Debug logging for Base Sepolia
  if (chainId === 84532) {
    console.log('[ONCHAIN-QUOTE-HOOK] useOnChainSwapQuote result', {
      chainId,
      isExactIn,
      enabled: onChainQuoteEnabled,
      isLoading: onChainQuote.isLoading,
      isError: onChainQuote.isError,
      hasData: !!onChainQuote.data,
      hasTxPayload: !!onChainQuote.data?.txPayload,
      error: onChainQuote.error?.message,
      amountIn: isExactIn ? amountSpecified?.toExact() : undefined,
      amountOut: !isExactIn ? amountSpecified?.toExact() : undefined,
    })
  }

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

  // For on-chain-only chains (Base Sepolia), always skip Trading API (never enable it)
  // On-chain routing now supports both exact input and exact output
  const shouldSkipTrade = useOnChainQuote || isOnChainOnlyChain(chainId as number | undefined)
  
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
    skip: shouldSkipTrade,
  })

  // Merge on-chain quote with trade results
  const mergedTrade = useMemo(() => {
    // If we have a successful on-chain quote, use it instead of Trading API trade
    if (useOnChainQuote && onChainQuote.data) {
      const { quoteAmountIn, quoteAmountOut, txPayload, route: routeResult, priceImpact } = onChainQuote.data
      
      // For exact output, quoteAmountIn is the calculated input; for exact input, quoteAmountOut is the calculated output
      const calculatedAmount = isExactIn ? quoteAmountOut : quoteAmountIn
      const specifiedAmount = amountSpecified
      const actualInputAmount = isExactIn ? specifiedAmount : calculatedAmount
      const actualOutputAmount = isExactIn ? calculatedAmount : specifiedAmount

      // Shape helper for debugging (local)
      const shape = (x: any) => ({
        t: typeof x,
        ctor: x?.constructor?.name,
        hasEqualTo: typeof x?.equalTo === 'function',
        hasQuotient: x?.quotient != null,
        hasCurrency: x?.currency != null,
        hasToExact: typeof x?.toExact === 'function',
      })

      if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
        const txTo = txPayload?.to ? String(txPayload.to).toLowerCase() : undefined
        const txDataLen = txPayload?.data?.length ?? 0
        logger.debugDeduped(
          'useDerivedSwapInfo',
          'useDerivedSwapInfo',
          'Using on-chain quote',
          {
            chainId,
            isExactIn,
            amountInRaw: actualInputAmount?.quotient?.toString(),
            amountInExact: actualInputAmount?.toExact(),
            amountOutRaw: actualOutputAmount?.quotient?.toString(),
            amountOutExact: actualOutputAmount?.toExact(),
            routeDescription: routeResult?.route ? String(routeResult.route) : undefined,
            hasRoute: !!routeResult?.route,
            txTo,
            txValue: txPayload?.value,
            txDataLen,
            txGasLimit: txPayload?.gasLimit,
            // Shape verification: ensure amounts are CurrencyAmount objects
            inputAmountShape: shape(amountSpecified),
            outputAmountShape: shape(quoteAmountOut),
          },
          {
            ttlMs: 5000,
            minIntervalMs: 5000,
            includeKeys: ['chainId', 'txTo', 'txDataLen'],
          }
        )
      }

      // Create execution price (always create a valid Price object for on-chain trades)
      // For exact input: price = output / input
      // For exact output: price = output / input (same formula, but amounts are reversed)
      let executionPrice: Price<Currency, Currency> | undefined
      const inputAmount = actualInputAmount
      const outputAmount = actualOutputAmount
      
      if (inputAmount && outputAmount && inputAmount.currency && outputAmount.currency) {
        try {
          // Try using divide method first (preferred as it handles decimals correctly)
          if (typeof outputAmount.divide === 'function') {
            executionPrice = outputAmount.divide(inputAmount)
          } else {
            // Fallback: construct Price directly from amounts
            executionPrice = new Price(
              inputAmount.currency,
              outputAmount.currency,
              inputAmount.quotient,
              outputAmount.quotient,
            )
          }
        } catch (error) {
          // If divide fails, construct Price directly
          try {
            executionPrice = new Price(
              inputAmount.currency,
              outputAmount.currency,
              inputAmount.quotient,
              outputAmount.quotient,
            )
          } catch (fallbackError) {
            // Last resort: log and leave undefined (UI will handle gracefully)
            if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
              logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'Failed to create executionPrice', {
                chainId,
                isExactIn,
                error: error instanceof Error ? error.message : String(error),
                fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              })
            }
          }
        }
      }

      // Build Route object from ValidatedRoute
      // Note: ValidatedRoute contains route.hops which we'd need to convert to pools
      // For now, we'll create a minimal trade object without the Route
      // The UI should work with just inputAmount, outputAmount, and executionPrice
      // Only set priceImpact if we have a valid value; leave undefined so UI shows "—"
      const priceImpactPercent: Percent | undefined = priceImpact !== undefined 
        ? new Percent(Math.round(priceImpact * 10000), 10000) 
        : undefined

      // Build quote adapter to satisfy upstream invariants (requestId, quote.quoteId)
      const quoteAdapter = buildOnChainQuoteAdapter(
        onChainQuote.data,
        chainId,
        amountSpecified?.quotient?.toString(),
        isExactIn,
      )

      // Calculate min/max amounts with slippage tolerance
      // For EXACT_INPUT: minAmountOut = outputAmount * (1 - slippage), maxAmountIn = inputAmount
      // For EXACT_OUTPUT: minAmountOut = outputAmount, maxAmountIn = inputAmount * (1 + slippage)
      const slippagePercent = slippageTolerance
      
      // Defensive: ensure quoteAmountOut is a CurrencyAmount-like object with multiply method
      // Check for both the method existence and that it's actually callable
      let minAmountOut: CurrencyAmount<Currency> | undefined = quoteAmountOut
      if (quoteAmountOut) {
        try {
          if (
            typeof quoteAmountOut === 'object' &&
            quoteAmountOut !== null &&
            typeof quoteAmountOut.multiply === 'function' &&
            typeof quoteAmountOut.currency !== 'undefined'
          ) {
            const oneMinusSlippage = new Percent(1).subtract(slippagePercent)
            minAmountOut = quoteAmountOut.multiply(oneMinusSlippage)
          } else {
            // Log warning if quoteAmountOut doesn't have expected structure
            if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
              logger.debugDeduped(
                'useDerivedSwapInfo',
                'useDerivedSwapInfo',
                'quoteAmountOut missing multiply method',
                {
                  chainId,
                  quoteAmountOutType: typeof quoteAmountOut,
                  hasMultiply: typeof quoteAmountOut?.multiply === 'function',
                  hasCurrency: typeof quoteAmountOut?.currency !== 'undefined',
                  quoteAmountOutShape: shape(quoteAmountOut),
                },
                {
                  ttlMs: 5000,
                  minIntervalMs: 5000,
                  keyParts: ['quoteAmountOut-missing-multiply', chainId],
                }
              )
            }
          }
        } catch (error) {
          // If multiply fails, fall back to original quoteAmountOut
          if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
            logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'quoteAmountOut.multiply failed', {
              chainId,
              error: error instanceof Error ? error.message : String(error),
              quoteAmountOutShape: shape(quoteAmountOut),
            })
          }
          minAmountOut = quoteAmountOut
        }
      }
      
      // Defensive: ensure amountSpecified is a CurrencyAmount-like object with multiply method
      let maxAmountIn: CurrencyAmount<Currency> | undefined = amountSpecified ?? undefined
      if (amountSpecified) {
        try {
          if (isExactIn) {
            // For EXACT_INPUT, maxAmountIn = inputAmount (no multiplication needed)
            maxAmountIn = amountSpecified
          } else if (
            typeof amountSpecified === 'object' &&
            amountSpecified !== null &&
            typeof amountSpecified.multiply === 'function' &&
            typeof amountSpecified.currency !== 'undefined'
          ) {
            // For EXACT_OUTPUT, maxAmountIn = inputAmount * (1 + slippage)
            const onePlusSlippage = new Percent(1).add(slippagePercent)
            maxAmountIn = amountSpecified.multiply(onePlusSlippage)
          }
        } catch (error) {
          // If multiply fails, fall back to original amountSpecified
          if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
            logger.debug('useDerivedSwapInfo', 'useDerivedSwapInfo', 'amountSpecified.multiply failed', {
              chainId,
              error: error instanceof Error ? error.message : String(error),
              amountSpecifiedShape: shape(amountSpecified),
            })
          }
          maxAmountIn = amountSpecified
        }
      }

      const onChainTrade = {
        inputAmount: actualInputAmount!,
        outputAmount: actualOutputAmount!,
        executionPrice,
        priceImpact: priceImpactPercent,
        routing: TradingApi.Routing.CLASSIC,
        // Route is optional - UI can work without it for on-chain quotes
        route: undefined,
        // Include quote adapter to satisfy upstream invariants (analytics, steps generation)
        quote: quoteAdapter,
        // Trade type and slippage (required for analytics)
        tradeType: isExactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
        // Convert Percent to number (decimal value, 0-1 range)
        slippageTolerance:
          JSBI.greaterThan(slippagePercent.asFraction.denominator, JSBI.BigInt(0))
            ? Number(slippagePercent.asFraction.numerator.toString()) /
              Number(slippagePercent.asFraction.denominator.toString())
            : 0,
        // Min/max amounts (required for analytics)
        minAmountOut: minAmountOut ?? actualOutputAmount,
        maxAmountIn: maxAmountIn ?? actualInputAmount,
        // Tax fields (default to 0 for on-chain trades)
        inputTax: new Percent(0, 100),
        outputTax: new Percent(0, 100),
        // Indicative flag (false for on-chain quotes)
        indicative: false,
        // Store on-chain data for transaction building
        onChainTxPayload: txPayload,
        onChainRoute: routeResult,
      }

      // Return a trade-like object that works with existing UI
      return {
        ...trade,
        // Expose full on-chain quote for downstream tx builder
        onChainQuote: onChainQuote.data,
        trade: onChainTrade as any, // Type assertion needed for compatibility
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
        onChainQuoteDataShape: onChainQuote.data
          ? {
              hasQuoteAmountOut: !!onChainQuote.data.quoteAmountOut,
              hasTxPayload: !!onChainQuote.data.txPayload,
              hasRoute: !!onChainQuote.data.route,
              txPayloadKeys: onChainQuote.data.txPayload ? Object.keys(onChainQuote.data.txPayload) : null,
              txPayloadTo: onChainQuote.data.txPayload?.to,
              txPayloadDataLen: (onChainQuote.data.txPayload?.data as string | undefined)?.length,
            }
          : null,
        isOnChainQuoteLoading: onChainQuote.isLoading,
        isOnChainQuoteError: onChainQuote.isError,
        onChainQuoteError: onChainQuote.error ? String(onChainQuote.error) : null,
      })
    }

    return trade
  }, [
    useOnChainQuote,
    // CRITICAL: Normalize all onChainQuote properties to ensure stable dependency array
    // When useOnChainQuote flips, these might become undefined, causing React to see different hook signatures
    onChainQuote.data ?? null,
    onChainQuote.isLoading,
    onChainQuote.isError,
    onChainQuote.error ?? null,
    currencyIn ?? null,
    currencyOut ?? null,
    amountSpecified ?? null,
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
    [
      exactCurrencyField,
      amountSpecified ?? null,
      displayableTrade?.inputAmount ?? null,
      displayableTradeOutputAmount ?? null,
    ],
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

  const finalOnChainQuote = useOnChainQuote && onChainQuote.data ? onChainQuote.data : undefined
  
  // Debug logging for Base Sepolia
  if (chainId === 84532) {
    console.log('[DERIVED-SWAP-INFO] Final derivedSwapInfo', {
      chainId,
      hasTrade: !!mergedTrade,
      useOnChainQuote,
      hasOnChainQuoteData: !!onChainQuote.data,
      hasFinalOnChainQuote: !!finalOnChainQuote,
      onChainQuoteHasTxPayload: !!finalOnChainQuote?.txPayload,
      onChainQuoteKeys: finalOnChainQuote ? Object.keys(finalOnChainQuote) : [],
      isExactIn,
    })
  }
  
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
      onChainQuote: finalOnChainQuote,
    }
  }, [
    chainId ?? null,
    currencies,
    currencyAmounts,
    currencyAmountsUSDValue,
    currencyBalances,
    exactAmountFiat ?? null,
    exactAmountToken ?? null,
    exactCurrencyField,
    focusOnCurrencyField ?? null,
    selectingCurrencyField ?? null,
    mergedTrade,
    txId ?? null,
    wrapType,
    displayableTrade ?? null,
    useOnChainQuote,
    // CRITICAL: Normalize onChainQuote to prevent dependency array structure changes
    // When useOnChainQuote flips, onChainQuote object structure might change
    // Normalize to a stable reference by using individual properties instead of the whole object
    onChainQuote.data ?? null,
    onChainQuote.isLoading,
    onChainQuote.isError,
    onChainQuote.error ?? null,
  ])
}
