import { TradingApi } from '@universe/api'
import { DynamicConfigs, SwapConfigKey, useDynamicConfigValue } from '@universe/gating'
import { providers } from 'ethers/lib/ethers'
import { useEffect, useRef } from 'react'
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
import { logger } from 'utilities/src/logger/logger'

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

  if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
    logger.debug('useTransactionRequestInfo', 'useSwapTransactionRequestInfo', 'Hook invoked', {
      chainId: derivedSwapInfo.chainId,
      hasOnChainQuote: !!onChainQuote,
      hasTxPayload: !!onChainTxPayload,
    })
  }

  // If we have an on-chain transaction payload, use it directly
  let onChainTxRequest: TransactionRequestInfo | undefined
  if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
    logger.debug('useTransactionRequestInfo', 'useSwapTransactionRequestInfo', 'On-chain quote presence', {
      chainId: derivedSwapInfo.chainId,
      hasOnChainQuote: !!onChainQuote,
      hasTxPayload: !!onChainTxPayload,
      txTo: onChainTxPayload?.to,
      txValue: onChainTxPayload?.value,
      txDataLen: (onChainTxPayload?.data as string | undefined)?.length,
      quoteOutRaw: onChainQuote?.quoteAmountOut?.quotient?.toString?.(),
      quoteOutExact: onChainQuote?.quoteAmountOut?.toExact?.(),
    })
  }
  if (onChainTxPayload && onChainQuote?.quoteAmountOut) {
    const txRequest: providers.TransactionRequest = {
      to: onChainTxPayload.to,
      data: onChainTxPayload.data,
      value: onChainTxPayload.value !== '0x0' ? onChainTxPayload.value : undefined,
      chainId: derivedSwapInfo.chainId,
    }
    if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
      logger.debug('useTransactionRequestInfo', 'useSwapTransactionRequestInfo', 'Using on-chain tx request', {
        chainId: derivedSwapInfo.chainId,
        to: txRequest.to,
        value: txRequest.value,
        dataLen: (txRequest.data as string | undefined)?.length,
        quoteOutRaw: onChainQuote.quoteAmountOut.quotient.toString(),
        quoteOutExact: onChainQuote.quoteAmountOut.toExact(),
      })
    }
    onChainTxRequest = {
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

  // Return on-chain transaction if available
  if (onChainTxRequest) {
    return onChainTxRequest
  }

  const permitData = derivedSwapInfo.trade.trade?.quote.permitData
  // On interface, we do not fetch signature until after swap is clicked, as it requires user interaction.
  const { data: signature } = usePermit2SignatureWithData({ permitData, skip: isWebApp })

  const quote = derivedSwapInfo.trade.trade?.quote
  const swapQuoteResponse = quote && (isClassic(quote) || isBridge(quote) || isWrap(quote)) ? quote : undefined
  const swapQuote = swapQuoteResponse?.quote

  const swapDelegationInfo = useUniswapContextSelector((ctx) => ctx.getSwapDelegationInfo?.(derivedSwapInfo.chainId))
  const overrideSimulation = !!swapDelegationInfo?.delegationAddress

  const prepareSwapRequestParams = createPrepareSwapRequestParams({ gasStrategy })

  const swapRequestParams =
    swapQuoteResponse &&
    prepareSwapRequestParams({
      swapQuoteResponse,
      signature: signature ?? undefined,
      transactionSettings,
      alreadyApproved: tokenApprovalInfo?.action === ApprovalAction.None && !swapQuoteResponse.permitTransaction,
      overrideSimulation,
    })

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
  const isOnChainEnabled = isOnChainRouterEnabled(derivedSwapInfo.chainId)

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

  const processSwapResponse = createProcessSwapResponse({ gasStrategy })
  const result = processSwapResponse({
    response: data,
    error,
    swapQuote,
    isSwapLoading,
    permitData,
    swapRequestParams,
    isRevokeNeeded: tokenApprovalInfo?.action === ApprovalAction.RevokeAndPermit2Approve,
    permitsDontNeedSignature,
  })

  // Only log analytics events once per request
  const previousRequestIdRef = useRef(swapQuoteResponse?.requestId)
  const logSwapRequestErrors = createLogSwapRequestErrors({ trace })

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
  // Derived swap info may temporarily lack nested trade data; guard access
  const permitData = derivedSwapInfo.trade?.trade?.quote?.permitData
  const uniswapXTransactionRequestInfo = useUniswapXTransactionRequestInfo(permitData)
  const swapTransactionRequestInfo = useSwapTransactionRequestInfo({ derivedSwapInfo, tokenApprovalInfo })

  if (derivedSwapInfo.trade.trade && isUniswapX(derivedSwapInfo.trade.trade)) {
    return uniswapXTransactionRequestInfo
  }

  return swapTransactionRequestInfo
}
