import { TradingApi } from '@universe/api'
import { Percent } from '@uniswap/sdk-core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flex, HeightAnimator, Text, TouchableArea } from 'ui/src'
import type { Warning } from 'uniswap/src/components/modals/WarningModal/types'
import type { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import type { GasFeeResult } from 'uniswap/src/features/gas/types'
import { EstimatedSwapTime } from 'uniswap/src/features/transactions/swap/components/EstimatedBridgeTime'
import { MaxSlippageRow } from 'uniswap/src/features/transactions/swap/components/MaxSlippageRow/MaxSlippageRow'
import { PriceImpactRow } from 'uniswap/src/features/transactions/swap/components/PriceImpactRow/PriceImpactRow'
import { RoutingInfo } from 'uniswap/src/features/transactions/swap/components/RoutingInfo'
import { SwapRateRatio } from 'uniswap/src/features/transactions/swap/components/SwapRateRatio'
import { useIsUnichainFlashblocksEnabled } from 'uniswap/src/features/transactions/swap/hooks/useIsUnichainFlashblocksEnabled'
import { usePriceUXEnabled } from 'uniswap/src/features/transactions/swap/hooks/usePriceUXEnabled'
import { useOnChainSwapDetails } from 'uniswap/src/features/transactions/swap/hooks/useOnChainSwapDetails'
import { useSwapReviewTransactionStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewTransactionStore/useSwapReviewTransactionStore'
import { AcceptNewQuoteRow } from 'uniswap/src/features/transactions/swap/review/SwapDetails/AcceptNewQuoteRow'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { formatPriceImpact } from 'uniswap/src/features/transactions/swap/utils/formatPriceImpact'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { UniswapXGasBreakdown } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { getSwapFeeUsdFromDerivedSwapInfo } from 'uniswap/src/features/transactions/swap/utils/getSwapFeeUsd'
import { isBridge, isChained } from 'uniswap/src/features/transactions/swap/utils/routing'
import { TransactionDetails } from 'uniswap/src/features/transactions/TransactionDetails/TransactionDetails'
import type {
  FeeOnTransferFeeGroupProps,
  TokenWarningProps,
} from 'uniswap/src/features/transactions/TransactionDetails/types'
import { CurrencyField } from 'uniswap/src/types/currency'
import { isMobileApp, isMobileWeb } from 'utilities/src/platform'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'

interface SwapDetailsProps {
  acceptedDerivedSwapInfo: DerivedSwapInfo<CurrencyInfo, CurrencyInfo>
  autoSlippageTolerance?: number
  customSlippageTolerance?: number
  derivedSwapInfo: DerivedSwapInfo<CurrencyInfo, CurrencyInfo>
  feeOnTransferProps?: FeeOnTransferFeeGroupProps
  tokenWarningProps: TokenWarningProps
  tokenWarningChecked?: boolean
  gasFallbackUsed?: boolean
  gasFee: GasFeeResult
  uniswapXGasBreakdown?: UniswapXGasBreakdown
  newTradeRequiresAcceptance: boolean
  warning?: Warning
  onAcceptTrade: () => void
  onShowWarning?: () => void
  setTokenWarningChecked?: (checked: boolean) => void
  txSimulationErrors?: TradingApi.TransactionFailureReason[]
  includesDelegation?: boolean
}

export function SwapDetails({
  acceptedDerivedSwapInfo,
  autoSlippageTolerance,
  customSlippageTolerance,
  derivedSwapInfo,
  feeOnTransferProps,
  tokenWarningProps,
  tokenWarningChecked,
  gasFee,
  uniswapXGasBreakdown,
  newTradeRequiresAcceptance,
  warning,
  onAcceptTrade,
  onShowWarning,
  setTokenWarningChecked,
  txSimulationErrors,
  includesDelegation,
}: SwapDetailsProps): JSX.Element {
  const priceUxEnabled = usePriceUXEnabled()
  const { t } = useTranslation()
  const { formatPercent } = useLocalizationContext()
  
  // Get swapTxContext from store to access approveTxRequest
  const swapTxContext = useSwapReviewTransactionStore((s) => s.swapTxContext)
  const approveTxRequest = swapTxContext?.approveTxRequest
  
  // Compute on-chain swap details for on-chain-only chains
  const chainId = acceptedDerivedSwapInfo?.chainId
  const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
  const { data: onChainDetails } = useOnChainSwapDetails({
    derivedSwapInfo: acceptedDerivedSwapInfo,
    approveTxRequest: approveTxRequest ? {
      to: approveTxRequest.to as string,
      data: approveTxRequest.data as string,
    } : undefined,
    enabled: isOnChainOnly && !!acceptedDerivedSwapInfo?.trade?.trade,
  })
  
  // State for rate toggle (on-chain-only swaps)
  const [showInverseRate, setShowInverseRate] = useState(false)

  const isBridgeTrade = derivedSwapInfo.trade.trade && isBridge(derivedSwapInfo.trade.trade)
  const routing = derivedSwapInfo.trade.trade?.routing

  // For on-chain-only swaps, use on-chain details directly instead of trade enrichment
  const baseTrade = derivedSwapInfo.trade.trade ?? derivedSwapInfo.trade.indicativeTrade
  const baseAcceptedTrade = acceptedDerivedSwapInfo.trade.trade ?? acceptedDerivedSwapInfo.trade.indicativeTrade
  
  // Create enriched trades with on-chain details for on-chain-only swaps
  const trade = useMemo(() => {
    if (!baseTrade) {
      return baseTrade
    }
    
    // For on-chain-only swaps, ensure executionPrice and priceImpact are set from on-chain details
    if (isOnChainOnly && onChainDetails) {
      const enrichedTrade = { ...baseTrade }
      // Always use on-chain computed executionPrice as source of truth
      if (onChainDetails.executionPrice) {
        enrichedTrade.executionPrice = onChainDetails.executionPrice
      }
      // Always use on-chain computed priceImpact as source of truth
      if (onChainDetails.priceImpactBps !== null) {
        enrichedTrade.priceImpact = new Percent(onChainDetails.priceImpactBps, 10000)
      } else {
        // Explicitly set to undefined so UI shows "—" instead of 0%
        enrichedTrade.priceImpact = undefined
      }
      return enrichedTrade
    }
    
    return baseTrade
  }, [baseTrade, isOnChainOnly, onChainDetails])
  
  const acceptedTrade = useMemo(() => {
    if (!baseAcceptedTrade) {
      return baseAcceptedTrade
    }
    
    // For on-chain-only swaps, ensure executionPrice and priceImpact are set from on-chain details
    if (isOnChainOnly && onChainDetails) {
      const enrichedTrade = { ...baseAcceptedTrade }
      // Always use on-chain computed executionPrice as source of truth
      if (onChainDetails.executionPrice) {
        enrichedTrade.executionPrice = onChainDetails.executionPrice
      }
      // Always use on-chain computed priceImpact as source of truth
      if (onChainDetails.priceImpactBps !== null) {
        enrichedTrade.priceImpact = new Percent(onChainDetails.priceImpactBps, 10000)
      } else {
        // Explicitly set to undefined so UI shows "—" instead of 0%
        enrichedTrade.priceImpact = undefined
      }
      return enrichedTrade
    }
    
    return baseAcceptedTrade
  }, [baseAcceptedTrade, isOnChainOnly, onChainDetails])

  const swapFeeUsd = getSwapFeeUsdFromDerivedSwapInfo(derivedSwapInfo)

  const showUnichainPoweredMessage = useIsUnichainFlashblocksEnabled(derivedSwapInfo.chainId)

  if (!trade) {
    throw new Error('Invalid render of `SwapDetails` with no `trade`')
  }

  if (!acceptedTrade) {
    throw new Error('Invalid render of `SwapDetails` with no `acceptedTrade`')
  }

  const estimatedSwapTime: number | undefined = useMemo(() => {
    const tradeQuote = derivedSwapInfo.trade.trade?.quote
    if (!tradeQuote) {
      return undefined
    }

    if (isChained(tradeQuote)) {
      // TODO: SWAP-458 - Add proper typings when available.
      return 'timeEstimateMs' in tradeQuote.quote ? (tradeQuote.quote.timeEstimateMs as number) : undefined
    }
    if (isBridge(tradeQuote)) {
      return tradeQuote.quote.estimatedFillTimeMs
    }

    return undefined
  }, [derivedSwapInfo.trade.trade?.quote])

  // Override gasFee with on-chain computed network cost for on-chain-only swaps
  // This ensures approval cost is shown when approval is required
  const displayGasFee = useMemo(() => {
    if (isOnChainOnly && onChainDetails?.networkCost && !onChainDetails.networkCost.error) {
      const networkCost = onChainDetails.networkCost
      // Convert on-chain network cost to GasFeeResult format
      if (networkCost.gasFeeWei !== undefined) {
        return {
          value: networkCost.gasFeeWei.toString(),
          displayValue: networkCost.gasFeeWei.toString(), // Will be formatted by NetworkFee component
          isLoading: false,
          error: null,
          params: networkCost.maxFeePerGas && networkCost.maxPriorityFeePerGas && networkCost.gasLimit
            ? {
                maxFeePerGas: networkCost.maxFeePerGas.toString(),
                maxPriorityFeePerGas: networkCost.maxPriorityFeePerGas.toString(),
                gasLimit: networkCost.gasLimit.toString(),
              }
            : networkCost.gasLimit
              ? {
                  gasPrice: '0', // Legacy format fallback
                  gasLimit: networkCost.gasLimit.toString(),
                }
              : undefined,
          gasEstimate: networkCost.gasLimit && networkCost.maxFeePerGas && networkCost.maxPriorityFeePerGas
            ? {
                gasLimit: networkCost.gasLimit.toString(),
                maxFeePerGas: networkCost.maxFeePerGas.toString(),
                maxPriorityFeePerGas: networkCost.maxPriorityFeePerGas.toString(),
              } as any
            : undefined,
        }
      }
    }
    // Fallback to original gasFee
    return gasFee
  }, [isOnChainOnly, onChainDetails, gasFee])

  return (
    <HeightAnimator animationDisabled={isMobileApp || isMobileWeb}>
      <TransactionDetails
        banner={
          newTradeRequiresAcceptance && (
            <AcceptNewQuoteRow
              acceptedDerivedSwapInfo={acceptedDerivedSwapInfo}
              derivedSwapInfo={derivedSwapInfo}
              onAcceptTrade={onAcceptTrade}
            />
          )
        }
        chainId={acceptedTrade.inputAmount.currency.chainId}
        feeOnTransferProps={feeOnTransferProps}
        tokenWarningProps={tokenWarningProps}
        tokenWarningChecked={tokenWarningChecked}
        setTokenWarningChecked={setTokenWarningChecked}
        gasFee={displayGasFee}
        swapFee={acceptedTrade.swapFee}
        swapFeeUsd={swapFeeUsd}
        indicative={acceptedTrade.indicative}
        outputCurrency={acceptedTrade.outputAmount.currency}
        showExpandedChildren={!!customSlippageTolerance}
        showNetworkLogo={!showUnichainPoweredMessage}
        showWarning={warning && !newTradeRequiresAcceptance}
        transactionUSDValue={derivedSwapInfo.currencyAmountsUSDValue[CurrencyField.OUTPUT]}
        uniswapXGasBreakdown={uniswapXGasBreakdown}
        warning={warning}
        estimatedSwapTime={estimatedSwapTime}
        routingType={routing}
        txSimulationErrors={txSimulationErrors}
        amountUserWillReceive={derivedSwapInfo.outputAmountUserWillReceive ?? undefined}
        includesDelegation={includesDelegation}
        onShowWarning={onShowWarning}
      >
        {/* Rate row - use on-chain details directly for on-chain-only swaps */}
        {isOnChainOnly && onChainDetails?.rate?.forward ? (
          <Flex row alignItems="center" justifyContent="space-between">
            <Text color="$neutral2" variant="body3">
              {t('swap.details.rate')}
            </Text>
            <TouchableArea onPress={() => setShowInverseRate(!showInverseRate)}>
              <Text color="$neutral1" variant="body3">
                {showInverseRate ? (onChainDetails.rate.inverse || '—') : (onChainDetails.rate.forward || '—')}
              </Text>
            </TouchableArea>
          </Flex>
        ) : (
          <Flex row alignItems="center" justifyContent="space-between">
            <Text color="$neutral2" variant="body3">
              {t('swap.details.rate')}
            </Text>
            <SwapRateRatio trade={trade} derivedSwapInfo={acceptedDerivedSwapInfo} justifyContent="flex-end" />
          </Flex>
        )}
        <EstimatedSwapTime showIfLongerThanCutoff={false} timeMs={estimatedSwapTime} />
        {isBridgeTrade === false && (
          <MaxSlippageRow
            acceptedDerivedSwapInfo={acceptedDerivedSwapInfo}
            autoSlippageTolerance={autoSlippageTolerance}
            customSlippageTolerance={customSlippageTolerance}
          />
        )}
        {!acceptedTrade.indicative && (
          <RoutingInfo trade={acceptedTrade} gasFee={gasFee} chainId={acceptedTrade.inputAmount.currency.chainId} />
        )}
        {/* Price Impact row - use on-chain details directly for on-chain-only swaps */}
        {!priceUxEnabled && (
          isOnChainOnly && onChainDetails ? (
            <>
              {onChainDetails.lpFeeBps !== null && onChainDetails.lpFeeBps > 0 && onChainDetails.lpFeeAmount && (
                <Flex row alignItems="center" justifyContent="space-between">
                  <Text color="$neutral2" variant="body3">
                    {t('swap.details.uniswapFee')}
                  </Text>
                  <Text color="$neutral1" variant="body3">
                    {(() => {
                      const lpFee = new Percent(onChainDetails.lpFeeBps, 10000)
                      const feePercent = formatPercent(lpFee)
                      const feeAmount = onChainDetails.lpFeeAmount.toSignificant(6)
                      return feeAmount && feePercent ? `${feeAmount} ${onChainDetails.lpFeeAmount.currency.symbol} (${feePercent})` : feePercent || '—'
                    })()}
                  </Text>
                </Flex>
              )}
              <Flex row alignItems="center" justifyContent="space-between">
                <Text color="$neutral2" variant="body3">
                  {t('swap.priceImpact')}
                </Text>
                <Text color="$neutral1" variant="body3">
                  {onChainDetails.priceImpactBps !== null 
                    ? (() => {
                        const priceImpact = new Percent(onChainDetails.priceImpactBps, 10000)
                        return formatPriceImpact(priceImpact, formatPercent) || '—'
                      })()
                    : '—'}
                </Text>
              </Flex>
            </>
          ) : (
            <PriceImpactRow derivedSwapInfo={acceptedDerivedSwapInfo} />
          )
        )}
      </TransactionDetails>
    </HeightAnimator>
  )
}
