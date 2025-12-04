import { TradingApi } from '@universe/api'
import { DynamicConfigs, SwapConfigKey, useDynamicConfigValue } from '@universe/gating'
import { providers } from 'ethers/lib/ethers'
import { useEffect, useMemo, useRef } from 'react'
import { useUniswapContextSelector } from 'uniswap/src/contexts/UniswapContext'
import { useTradingApiSwapQuery } from 'uniswap/src/data/apiClients/tradingApi/useTradingApiSwapQuery'
import { useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { useAllTransactionSettings } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { FALLBACK_SWAP_REQUEST_POLL_INTERVAL_MS } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/constants'
import { processUniswapXResponse } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/uniswapx/utils'
import type { TransactionRequestInfo } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/utils'
import {
  createLogSwapRequestErrors,
  createPrepareSwapRequestParams,
  createProcessSwapResponse,
  getShouldSkipSwapRequest,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/utils'
import { usePermit2SignatureWithData } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/usePermit2Signature'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { TokenApprovalInfo } from 'uniswap/src/features/transactions/swap/types/trade'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { isBridge, isClassic, isUniswapX, isWrap } from 'uniswap/src/features/transactions/swap/utils/routing'
import { isWebApp } from 'utilities/src/platform'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'
import { ONE_SECOND_MS } from 'utilities/src/time/time'

function useSwapTransactionRequestInfo({
  derivedSwapInfo,
  tokenApprovalInfo,
}: {
  derivedSwapInfo: DerivedSwapInfo
  tokenApprovalInfo: TokenApprovalInfo | undefined
}): TransactionRequestInfo {
  const trace = useTrace()
  const gasStrategy = useActiveGasStrategy(derivedSwapInfo.chainId, 'general')
  const transactionSettings = useAllTransactionSettings()

  // Check if we have an on-chain quote with transaction payload
  const onChainQuote = (derivedSwapInfo as any).onChainQuote
  const onChainTxPayload = onChainQuote?.txPayload

  // If we have an on-chain transaction payload, use it directly
  const onChainTxRequest = useMemo(() => {
    if (onChainTxPayload && onChainQuote?.quoteAmountOut) {
      const txRequest: providers.TransactionRequest = {
        to: onChainTxPayload.to,
        data: onChainTxPayload.data,
        value: onChainTxPayload.value !== '0x0' ? onChainTxPayload.value : undefined,
        chainId: derivedSwapInfo.chainId,
      }

      return {
        txRequests: [txRequest],
        permitData: undefined,
        gasFeeResult: {
          gasEstimate: undefined,
          params: undefined,
        },
        gasEstimate: {
          swapEstimate: undefined,
        },
        swapRequestArgs: undefined,
        includesDelegation: false,
      } as TransactionRequestInfo
    }
    return undefined
  }, [onChainTxPayload, onChainQuote, derivedSwapInfo.chainId])

  // Return on-chain transaction if available
  if (onChainTxRequest) {
    return onChainTxRequest
  }

  const permitData = derivedSwapInfo.trade.trade?.quote.permitData
  // On interface, we do not fetch signature until after swap is clicked, as it requires user interaction.
  const { data: signature } = usePermit2SignatureWithData({ permitData, skip: isWebApp })

  const swapQuoteResponse = useMemo(() => {
    const quote = derivedSwapInfo.trade.trade?.quote
    if (quote && (isClassic(quote) || isBridge(quote) || isWrap(quote))) {
      return quote
    }
    return undefined
  }, [derivedSwapInfo.trade.trade?.quote])

  const swapQuote = swapQuoteResponse?.quote

  const swapDelegationInfo = useUniswapContextSelector((ctx) => ctx.getSwapDelegationInfo?.(derivedSwapInfo.chainId))
  const overrideSimulation = !!swapDelegationInfo?.delegationAddress

  const prepareSwapRequestParams = useMemo(() => createPrepareSwapRequestParams({ gasStrategy }), [gasStrategy])

  const swapRequestParams = useMemo(() => {
    if (!swapQuoteResponse) {
      return undefined
    }

    const alreadyApproved = tokenApprovalInfo?.action === ApprovalAction.None && !swapQuoteResponse.permitTransaction

    return prepareSwapRequestParams({
      swapQuoteResponse,
      signature: signature ?? undefined,
      transactionSettings,
      alreadyApproved,
      overrideSimulation,
    })
  }, [
    swapQuoteResponse,
    tokenApprovalInfo?.action,
    prepareSwapRequestParams,
    signature,
    transactionSettings,
    overrideSimulation,
  ])

  const canBatchTransactions = useUniswapContextSelector((ctx) =>
    ctx.getCanBatchTransactions?.(derivedSwapInfo.chainId),
  )

  const permitsDontNeedSignature = !!canBatchTransactions
  const shouldSkipSwapRequest = getShouldSkipSwapRequest({
    derivedSwapInfo,
    tokenApprovalInfo,
    signature: signature ?? undefined,
    permitsDontNeedSignature,
  })

  // Check if on-chain router is enabled for this chain - if so, skip Trading API swap request
  const isOnChainEnabled = useMemo(() => {
    return isOnChainRouterEnabled(derivedSwapInfo.chainId)
  }, [derivedSwapInfo.chainId])

  const tradingApiSwapRequestMs = useDynamicConfigValue({
    config: DynamicConfigs.Swap,
    key: SwapConfigKey.TradingApiSwapRequestMs,
    defaultValue: FALLBACK_SWAP_REQUEST_POLL_INTERVAL_MS,
  })

  // Development warning if Trading API would be called for on-chain enabled chain
  if (process.env.NODE_ENV !== 'production' && isOnChainEnabled && swapRequestParams) {
    console.warn(
      '[useTransactionRequestInfo] Trading API swap request blocked for on-chain enabled chain:',
      derivedSwapInfo.chainId,
    )
  }

  const {
    data,
    error,
    isLoading: isSwapLoading,
  } = useTradingApiSwapQuery(
    {
      // Skip Trading API swap request if on-chain router is enabled
      params: isOnChainEnabled || shouldSkipSwapRequest ? undefined : swapRequestParams,
      refetchInterval: tradingApiSwapRequestMs,
      staleTime: tradingApiSwapRequestMs,
      // We add a small buffer in case connection is too slow
      immediateGcTime: tradingApiSwapRequestMs + ONE_SECOND_MS * 5,
    },
    {
      canBatchTransactions,
      swapDelegationAddress: swapDelegationInfo?.delegationAddress,
      includesDelegation: swapDelegationInfo?.delegationInclusion,
    },
  )

  const processSwapResponse = useMemo(() => createProcessSwapResponse({ gasStrategy }), [gasStrategy])

  const result = useMemo(
    () =>
      processSwapResponse({
        response: data,
        error,
        swapQuote,
        isSwapLoading,
        permitData,
        swapRequestParams,
        isRevokeNeeded: tokenApprovalInfo?.action === ApprovalAction.RevokeAndPermit2Approve,
        permitsDontNeedSignature,
      }),
    [
      data,
      error,
      isSwapLoading,
      permitData,
      swapQuote,
      swapRequestParams,
      processSwapResponse,
      tokenApprovalInfo?.action,
      permitsDontNeedSignature,
    ],
  )

  // Only log analytics events once per request
  const previousRequestIdRef = useRef(swapQuoteResponse?.requestId)
  const logSwapRequestErrors = useMemo(() => createLogSwapRequestErrors({ trace }), [trace])

  useEffect(() => {
    logSwapRequestErrors({
      txRequest: result.txRequests?.[0],
      gasFeeResult: result.gasFeeResult,
      derivedSwapInfo,
      transactionSettings,
      previousRequestId: previousRequestIdRef.current,
    })

    if (swapQuoteResponse) {
      previousRequestIdRef.current = swapQuoteResponse.requestId
    }
  }, [logSwapRequestErrors, result, derivedSwapInfo, transactionSettings, swapQuoteResponse])

  return result
}

function useUniswapXTransactionRequestInfo(permitData: TradingApi.NullablePermit | undefined): TransactionRequestInfo {
  return useMemo(
    () =>
      processUniswapXResponse({
        permitData,
      }),
    [permitData],
  )
}

export function useTransactionRequestInfo({
  derivedSwapInfo,
  tokenApprovalInfo,
}: {
  derivedSwapInfo: DerivedSwapInfo
  tokenApprovalInfo: TokenApprovalInfo | undefined
}): TransactionRequestInfo {
  const uniswapXTransactionRequestInfo = useUniswapXTransactionRequestInfo(
    derivedSwapInfo.trade.trade?.quote.permitData,
  )
  const swapTransactionRequestInfo = useSwapTransactionRequestInfo({ derivedSwapInfo, tokenApprovalInfo })

  if (derivedSwapInfo.trade.trade && isUniswapX(derivedSwapInfo.trade.trade)) {
    return uniswapXTransactionRequestInfo
  }

  return swapTransactionRequestInfo
}
