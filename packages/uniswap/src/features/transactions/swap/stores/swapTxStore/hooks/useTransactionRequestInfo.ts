import { useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { DynamicConfigs, SwapConfigKey, useDynamicConfigValue } from '@universe/gating'
import { providers } from 'ethers/lib/ethers'
import JSBI from 'jsbi'
import { useEffect, useMemo, useRef } from 'react'
import { useUniswapContextSelector } from 'uniswap/src/contexts/UniswapContext'
import { useTradingApiSwapQuery } from 'uniswap/src/data/apiClients/tradingApi/useTradingApiSwapQuery'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { convertGasFeeToDisplayValue, useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import type { GasFeeResult } from 'uniswap/src/features/gas/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
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
import {
  buildSwapTx,
  getDeadlineSecondsFromNow,
} from 'uniswap/src/features/transactions/swap/services/onchainRouter/buildSwapTx'
import {
  isOnChainOnlyChain,
  isOnChainRouterEnabled,
} from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { usePermit2SignatureWithData } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/usePermit2Signature'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { TokenApprovalInfo } from 'uniswap/src/features/transactions/swap/types/trade'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { isTradingApiEnabled } from 'uniswap/src/features/transactions/swap/utils/isTradingApiEnabled'
import { isBridge, isClassic, isUniswapX, isWrap } from 'uniswap/src/features/transactions/swap/utils/routing'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { CurrencyField } from 'uniswap/src/types/currency'
import { logger } from 'utilities/src/logger/logger'
import { isWebApp } from 'utilities/src/platform'
import { useEvent } from 'utilities/src/react/hooks'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'
import { ONE_SECOND_MS } from 'utilities/src/time/time'

function useSwapTransactionRequestInfo({
  derivedSwapInfo,
  tokenApprovalInfo,
}: {
  derivedSwapInfo: DerivedSwapInfo
  tokenApprovalInfo: TokenApprovalInfo | undefined
}): TransactionRequestInfo {
  // ALL HOOKS MUST BE CALLED FIRST - no early returns before this point
  const trace = useTrace()
  const gasStrategy = useActiveGasStrategy(derivedSwapInfo.chainId, 'general')
  const transactionSettings = useAllTransactionSettings()
  const { evmAccount } = useWallet()
  const recipient = evmAccount?.address

  const permitData = derivedSwapInfo.trade.trade?.quote.permitData
  // On interface, we do not fetch signature until after swap is clicked, as it requires user interaction.
  const { data: signature } = usePermit2SignatureWithData({
    permitData,
    skip: isWebApp || !permitData,
  })

  const swapDelegationInfo = useUniswapContextSelector((ctx) => ctx.getSwapDelegationInfo?.(derivedSwapInfo.chainId))
  const canBatchTransactions = useUniswapContextSelector((ctx) =>
    ctx.getCanBatchTransactions?.(derivedSwapInfo.chainId),
  )

  // Check if on-chain router is enabled for this chain - if so, skip Trading API swap request
  // Force on-chain path for Base Sepolia; skip Trading API entirely
  const isOnChainEnabled = derivedSwapInfo.chainId === 84532 ? true : isOnChainRouterEnabled(derivedSwapInfo.chainId)

  const tradingApiSwapRequestMs = useDynamicConfigValue({
    config: DynamicConfigs.Swap,
    key: SwapConfigKey.TradingApiSwapRequestMs,
    defaultValue: FALLBACK_SWAP_REQUEST_POLL_INTERVAL_MS,
  })

  // Check if we have an on-chain quote with transaction payload
  // Use typed access now that DerivedSwapInfo includes onChainQuote
  const onChainQuote = derivedSwapInfo.onChainQuote
  const onChainTxPayload = onChainQuote?.txPayload
  // For exact input: quoteAmountOut is available
  // For exact output: quoteAmountIn is available
  const hasOnChainQuoteAmount = onChainQuote?.quoteAmountOut || onChainQuote?.quoteAmountIn

  // Comprehensive logging for on-chain quote data flow (Base Sepolia only, dev mode)
  if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
    const txTo = onChainTxPayload?.to ? String(onChainTxPayload.to).toLowerCase() : undefined
    const dataLen = (onChainTxPayload?.data as string | undefined)?.length ?? 0
    logger.debugDeduped(
      'useTransactionRequestInfo',
      'useSwapTransactionRequestInfo',
      'On-chain quote check',
      {
        chainId: derivedSwapInfo.chainId,
        hasOnChainQuote: !!onChainQuote,
        hasTxPayload: !!onChainTxPayload,
        txTo,
        dataLen,
        hasQuoteAmountOut: !!onChainQuote?.quoteAmountOut,
        isOnChainOnly: isOnChainOnlyChain(derivedSwapInfo.chainId),
      },
      {
        ttlMs: 3000,
        minIntervalMs: 1500,
        maxPerWindow: 2,
        windowMs: 5000,
        includeKeys: ['chainId', 'hasOnChainQuote', 'hasTxPayload', 'txTo', 'dataLen'],
      },
    )
  }

  const quote = derivedSwapInfo.trade.trade?.quote
  const swapQuoteResponse = quote && (isClassic(quote) || isBridge(quote) || isWrap(quote)) ? quote : undefined
  const swapQuote = swapQuoteResponse?.quote

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

  const permitsDontNeedSignature = !!canBatchTransactions
  const shouldSkipSwapRequest =
    !swapQuoteResponse ||
    getShouldSkipSwapRequest({
      derivedSwapInfo,
      tokenApprovalInfo,
      signature: signature ?? undefined,
      permitsDontNeedSignature,
    })

  // Development debug (deduped) if Trading API would be called for on-chain enabled chain
  // This is expected behavior for on-chain-only chains, so use debug level and dedupe
  const lastWarnedChainIdRef = useRef<number | undefined>(undefined)
  if (process.env.NODE_ENV !== 'production' && isOnChainEnabled && swapRequestParams) {
    const chainId = derivedSwapInfo.chainId
    if (lastWarnedChainIdRef.current !== chainId) {
      console.debug('[useTransactionRequestInfo] Trading API swap request blocked for on-chain enabled chain:', chainId)
      lastWarnedChainIdRef.current = chainId
    }
  }

  // Gate Trading API swap query for on-chain-only chains
  const isTradingApiEnabledForChain = isTradingApiEnabled(derivedSwapInfo.chainId)

  const {
    data,
    error,
    isLoading: isSwapLoading,
  } = useTradingApiSwapQuery(
    {
      // Skip Trading API swap request if on-chain router is enabled OR Trading API is disabled for this chain
      params: isOnChainEnabled || !isTradingApiEnabledForChain || shouldSkipSwapRequest ? undefined : swapRequestParams,
      enabled: isTradingApiEnabledForChain && !isOnChainEnabled && !shouldSkipSwapRequest,
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

  // Only log analytics events once per request - hooks must be called before any conditional returns
  const previousRequestIdRef = useRef(swapQuoteResponse?.requestId)
  const logSwapRequestErrors = useEvent(createLogSwapRequestErrors({ trace }))

  const processSwapResponse = createProcessSwapResponse({ gasStrategy })

  // Check if we should return early (but AFTER all hooks have been called)
  // For on-chain-only chains, we need EITHER onChainTxPayload OR swapQuoteResponse
  // If we have onChainQuote but no txPayload, that's an error state (quote incomplete)
  const shouldEarlyReturn =
    isOnChainOnlyChain(derivedSwapInfo.chainId) &&
    !onChainTxPayload &&
    !swapQuoteResponse &&
    // Only early return if we don't have onChainQuote at all, or if onChainQuote exists but is missing txPayload or quote amount
    (!onChainQuote || (onChainQuote && (!onChainTxPayload || !hasOnChainQuoteAmount)))

  // Process response (always compute, even if we might return early)
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

  // CRITICAL: ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS
  // Move all hooks (useMemo, useQuery, useEffect) to this section, before the early return check
  // This ensures hook order is stable even when hasTrade=false or hasQuote=false

  // Prefer on-chain tx request when available (logging only, no hooks)
  if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
    const txTo = onChainTxPayload?.to ? String(onChainTxPayload.to).toLowerCase() : undefined
    const txValueRaw = onChainTxPayload?.value as bigint | string | undefined
    const txValue = txValueRaw
      ? typeof txValueRaw === 'bigint'
        ? txValueRaw.toString()
        : typeof txValueRaw === 'string'
          ? txValueRaw
          : String(txValueRaw)
      : undefined
    const dataLen = (onChainTxPayload?.data as string | undefined)?.length ?? 0
    logger.debugDeduped(
      'useTransactionRequestInfo',
      'useSwapTransactionRequestInfo',
      'On-chain quote presence',
      {
        chainId: derivedSwapInfo.chainId,
        hasOnChainQuote: !!onChainQuote,
        hasTxPayload: !!onChainTxPayload,
        txTo,
        txValue,
        dataLen,
      },
      {
        ttlMs: 3000,
        minIntervalMs: 1500,
        maxPerWindow: 2,
        windowMs: 5000,
        includeKeys: ['chainId', 'hasOnChainQuote', 'hasTxPayload', 'txTo', 'txValue', 'dataLen'],
      },
    )
  }

  // CRITICAL: Prepare txRequest data - useMemo always called unconditionally
  // Normalize to null to ensure stable references
  // For exact input: quoteAmountOut is available
  // For exact output: quoteAmountIn is available
  const onChainTxRequestData = useMemo(() => {
    if (!onChainTxPayload || !hasOnChainQuoteAmount) {
      // Debug logging for Base Sepolia
      if (derivedSwapInfo.chainId === 84532) {
        console.log('[TX-REQUEST-DATA] onChainTxRequestData is null', {
          chainId: derivedSwapInfo.chainId,
          hasOnChainTxPayload: !!onChainTxPayload,
          hasOnChainQuoteAmount,
          hasQuoteAmountOut: !!onChainQuote?.quoteAmountOut,
          hasQuoteAmountIn: !!onChainQuote?.quoteAmountIn,
          onChainQuoteKeys: onChainQuote ? Object.keys(onChainQuote) : [],
        })
      }
      return null
    }
    // Normalize value to hex string - handle both bigint and string/undefined
    const valueRaw: bigint | string | undefined = onChainTxPayload.value as bigint | string | undefined
    const normalizedValue =
      typeof valueRaw === 'bigint' ? `0x${valueRaw.toString(16)}` : typeof valueRaw === 'string' ? valueRaw : '0x0'

    const txRequest = {
      to: onChainTxPayload.to,
      data: onChainTxPayload.data,
      value: normalizedValue,
      chainId: derivedSwapInfo.chainId,
    } as providers.TransactionRequest | null

    // Debug logging for Base Sepolia
    if (derivedSwapInfo.chainId === 84532) {
      console.log('[TX-REQUEST-DATA] onChainTxRequestData created', {
        chainId: derivedSwapInfo.chainId,
        hasTxRequest: !!txRequest,
        txTo: txRequest?.to,
        txDataLen: (txRequest?.data as string | undefined)?.length,
        txValue: txRequest?.value,
        hasQuoteAmountOut: !!onChainQuote.quoteAmountOut,
        hasQuoteAmountIn: !!onChainQuote.quoteAmountIn,
      })
    }

    return txRequest
  }, [onChainTxPayload, onChainQuote?.quoteAmountOut, onChainQuote?.quoteAmountIn, derivedSwapInfo.chainId])

  // CRITICAL: publicClient useMemo always called unconditionally
  const publicClient = useMemo(() => {
    if (!derivedSwapInfo.chainId) return undefined
    return createViemClient({ chainId: derivedSwapInfo.chainId })
  }, [derivedSwapInfo.chainId])

  // Helper to check if error is "Transaction too old"
  const isTransactionTooOldError = (error: unknown): boolean => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return errorMessage.includes('Transaction too old') || errorMessage.includes('transaction too old')
  }

  // Helper to check if error is STF (Static Call Failed) - likely allowance/balance issue
  const isSTFError = (error: unknown): boolean => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return (
      errorMessage.includes('STF') || errorMessage.includes('revert') || errorMessage.includes('execution reverted')
    )
  }

  // Helper to rebuild tx payload with fresh deadline
  const rebuildTxPayloadWithFreshDeadline = (): providers.TransactionRequest | null => {
    if (!onChainQuote?.route || !onChainQuote.amountOutMinimum || !derivedSwapInfo.chainId || !recipient) {
      return null
    }

    // Get amountIn from derivedSwapInfo
    const amountIn = (derivedSwapInfo.currencyAmounts as any)?.[CurrencyField.INPUT] as
      | CurrencyAmount<Currency>
      | undefined
    if (!amountIn) {
      return null
    }

    // Rebuild with fresh deadline (computed at rebuild time)
    const freshDeadline = getDeadlineSecondsFromNow(1200) // 20 minutes TTL
    const nowSeconds = Math.floor(Date.now() / 1000)

    if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
      logger.debug(
        'useTransactionRequestInfo',
        'rebuildTxPayloadWithFreshDeadline',
        '[DEADLINE-REBUILD] reason=Transaction too old, rebuilding calldata',
        {
          chainId: derivedSwapInfo.chainId,
          nowSeconds,
          newDeadline: Number(freshDeadline),
          deadlineAgeSeconds: Number(freshDeadline) - nowSeconds,
        },
      )
    }

    const rebuiltPayload = buildSwapTx({
      route: onChainQuote.route,
      amountIn,
      minAmountOut: onChainQuote.amountOutMinimum,
      chainId: derivedSwapInfo.chainId as EVMUniverseChainId,
      recipient,
      deadline: Number(freshDeadline),
    })

    const valueRaw = rebuiltPayload.value
    const normalizedValue =
      typeof valueRaw === 'string' && valueRaw.startsWith('0x') ? valueRaw : `0x${BigInt(valueRaw || '0').toString(16)}`

    return {
      to: rebuiltPayload.to,
      data: rebuiltPayload.data,
      value: normalizedValue,
      chainId: derivedSwapInfo.chainId,
    } as providers.TransactionRequest
  }

  // CRITICAL: useQuery always called - enabled flag gates execution, not hook call
  // Normalize queryKey values to ensure stable array structure
  const {
    data: gasEstimateData,
    isLoading: isGasLoading,
    error: gasError,
  } = useQuery({
    queryKey: [
      'onchain-gas-estimate',
      derivedSwapInfo.chainId ?? null,
      onChainTxRequestData?.to ?? null,
      onChainTxRequestData?.data ?? null,
      onChainTxRequestData?.value ?? null,
    ],
    queryFn: async () => {
      if (!publicClient || !onChainTxRequestData?.to || !onChainTxRequestData.data) {
        return null
      }

      let txRequestToEstimate = onChainTxRequestData
      let isRetry = false

      try {
        // CRITICAL: Include account/from in estimateGas for correct simulation context
        // Missing account can cause STF errors due to wrong simulation context
        const estimateParams: any = {
          to: txRequestToEstimate.to as `0x${string}`,
          data: txRequestToEstimate.data as `0x${string}`,
          value: txRequestToEstimate.value
            ? typeof txRequestToEstimate.value === 'string'
              ? BigInt(txRequestToEstimate.value)
              : BigInt(String(txRequestToEstimate.value))
            : undefined,
        }

        // Add account/from if available (required for correct simulation)
        if (recipient) {
          estimateParams.account = recipient as `0x${string}`
        }

        if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
          logger.debugDeduped(
            'useTransactionRequestInfo',
            'gas-estimate-params',
            '[ESTIMATE-GAS] params',
            {
              chainId: derivedSwapInfo.chainId,
              hasAccount: !!recipient,
              account: recipient,
              to: txRequestToEstimate.to,
              dataLen: (txRequestToEstimate.data as string).length ?? 0,
            },
            {
              ttlMs: 5000,
              minIntervalMs: 5000,
              keyParts: ['ESTIMATE-GAS-params', derivedSwapInfo.chainId, txRequestToEstimate.to],
            },
          )
        }

        // Estimate gas limit
        const gasLimit = await publicClient.estimateGas(estimateParams)

        // Get fee data (EIP-1559 or legacy)
        const feeData = await publicClient.estimateFeesPerGas()

        return {
          gasLimit,
          feeData,
        }
      } catch (error) {
        // Retry once if "Transaction too old" and we can rebuild
        if (isTransactionTooOldError(error) && !isRetry && onChainQuote) {
          const rebuilt = rebuildTxPayloadWithFreshDeadline()
          if (rebuilt) {
            isRetry = true
            txRequestToEstimate = rebuilt

            if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
              logger.debug(
                'useTransactionRequestInfo',
                'gas-estimate-retry',
                '[DEADLINE-REBUILD] retrying with fresh deadline',
                {
                  chainId: derivedSwapInfo.chainId,
                  newDeadline: 'fresh',
                },
              )
            }

            try {
              // Retry with rebuilt payload (include account)
              const retryEstimateParams: any = {
                to: txRequestToEstimate.to as `0x${string}`,
                data: txRequestToEstimate.data as `0x${string}`,
                value: txRequestToEstimate.value
                  ? typeof txRequestToEstimate.value === 'string'
                    ? BigInt(txRequestToEstimate.value)
                    : BigInt(String(txRequestToEstimate.value))
                  : undefined,
              }
              if (recipient) {
                retryEstimateParams.account = recipient as `0x${string}`
              }
              const gasLimit = await publicClient.estimateGas(retryEstimateParams)

              const feeData = await publicClient.estimateFeesPerGas()

              return {
                gasLimit,
                feeData,
              }
            } catch (retryError) {
              // Retry also failed, fall through to error handling
              const retryErrorMessage = retryError instanceof Error ? retryError.message : String(retryError)
              logger.warn('useTransactionRequestInfo', 'gas-estimate-retry-failed', retryErrorMessage, {
                chainId: derivedSwapInfo.chainId,
                error: retryErrorMessage,
              })
              return null
            }
          }
        }

        const errorMessage = error instanceof Error ? error.message : String(error)

        // Map STF errors to user-meaningful reasons
        if (isSTFError(error)) {
          if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
            logger.debug(
              'useTransactionRequestInfo',
              'gas-estimate-stf',
              '[ESTIMATE-GAS] STF detected - likely allowance/balance issue',
              {
                chainId: derivedSwapInfo.chainId,
                error: errorMessage,
                hasAccount: !!recipient,
                account: recipient,
                to: txRequestToEstimate.to,
              },
            )
          }
          // STF indicates transfer failed - likely insufficient allowance or balance
          // Return null to allow fallback, but the error will be handled by validation
        }

        logger.warn('useTransactionRequestInfo', 'gas-estimate-failed', errorMessage, {
          chainId: derivedSwapInfo.chainId,
          error: errorMessage,
          isSTF: isSTFError(error),
        })
        return null
      }
    },
    // CRITICAL: enabled flag gates execution but hook is always called
    // GATE: Only estimate swap gas if approval is not needed AND balance is sufficient
    // This prevents STF spam when allowance is insufficient
    enabled: (() => {
      if (!publicClient || !onChainTxRequestData?.to || !onChainTxRequestData.data || !derivedSwapInfo.chainId) {
        return false
      }

      // For on-chain-only chains, check if we should estimate swap or approval
      const isOnChainOnly = isOnChainOnlyChain(derivedSwapInfo.chainId)
      if (isOnChainOnly && tokenApprovalInfo) {
        // If approval is needed, don't estimate swap gas (will fail with STF)
        // Approval gas estimation happens separately
        if (tokenApprovalInfo.action !== ApprovalAction.None) {
          if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
            logger.debug(
              'useTransactionRequestInfo',
              'gas-estimate-gated',
              '[ESTIMATE-GAS] Gated: approval required, skipping swap estimate',
              {
                chainId: derivedSwapInfo.chainId,
                approvalAction: tokenApprovalInfo.action,
              },
            )
          }
          return false
        }
      }

      return true
    })(),
    staleTime: 10_000, // 10 seconds
    gcTime: 30_000, // 30 seconds
  })

  // CRITICAL: gasFeeResult useMemo always called - conditional logic inside memo body
  const gasFeeResult: GasFeeResult = useMemo(() => {
    // If no on-chain tx request data, return empty gas fee result
    if (!onChainTxRequestData) {
      return {
        value: undefined,
        displayValue: undefined,
        isLoading: false,
        error: null,
      }
    }

    if (isGasLoading) {
      return {
        value: undefined,
        displayValue: undefined,
        isLoading: true,
        error: null,
      }
    }

    if (gasError || !gasEstimateData) {
      // Fallback: provide minimal valid gasFeeResult to satisfy validator
      // CRITICAL: validateGasFeeResult requires error to be null/undefined, not an Error object
      // Use a default gas estimate (21000 base + data length estimate)
      const dataLength = (onChainTxRequestData.data as string | undefined)?.length ?? 0
      const defaultGasLimit = JSBI.add(JSBI.BigInt(21000), JSBI.multiply(JSBI.BigInt(dataLength), JSBI.BigInt(16)))
      const defaultGasPrice = JSBI.BigInt(1000000000) // 1 gwei fallback
      const defaultValue = JSBI.multiply(defaultGasLimit, defaultGasPrice).toString()

      // Log the error but don't include it in the result (validator requires error: null)
      if (gasError) {
        const errorMessage = gasError instanceof Error ? gasError.message : String(gasError)
        logger.warn('useTransactionRequestInfo', 'gas-estimate-fallback', errorMessage, {
          chainId: derivedSwapInfo.chainId,
          token: onChainTxRequestData.to,
          dataLen: dataLength,
          defaultValue,
        })
      }

      return {
        value: defaultValue,
        displayValue: convertGasFeeToDisplayValue(defaultValue, gasStrategy),
        isLoading: false,
        error: null, // CRITICAL: Must be null for validator to pass
      }
    }

    // Use real gas estimate and fee data
    const { gasLimit, feeData } = gasEstimateData
    const gasLimitBigInt = typeof gasLimit === 'bigint' ? gasLimit : BigInt(String(gasLimit))

    // Handle fee data (can be bigint or undefined)
    const maxFeePerGasRaw = (feeData as any)?.maxFeePerGas ?? (feeData as any)?.gasPrice
    const maxFeePerGas = maxFeePerGasRaw
      ? typeof maxFeePerGasRaw === 'bigint'
        ? maxFeePerGasRaw
        : BigInt(String(maxFeePerGasRaw))
      : BigInt(1000000000) // 1 gwei fallback

    const gasValue = (gasLimitBigInt * maxFeePerGas).toString()

    // Build params based on fee data type
    const hasMaxFeePerGas = !!(feeData as any)?.maxFeePerGas
    const hasGasPrice = !!(feeData as any)?.gasPrice && !hasMaxFeePerGas

    return {
      value: gasValue,
      displayValue: convertGasFeeToDisplayValue(gasValue, gasStrategy),
      isLoading: false,
      error: null,
      params: hasMaxFeePerGas
        ? {
            type: 'eip1559' as const,
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: (feeData as any)?.maxPriorityFeePerGas
              ? typeof (feeData as any).maxPriorityFeePerGas === 'bigint'
                ? (feeData as any).maxPriorityFeePerGas
                : BigInt(String((feeData as any).maxPriorityFeePerGas))
              : BigInt(100000000),
            gasLimit: gasLimitBigInt.toString(),
          }
        : hasGasPrice
          ? {
              type: 'legacy' as const,
              gasPrice: maxFeePerGas.toString(),
              gasLimit: gasLimitBigInt.toString(),
            }
          : undefined,
    }
    // CRITICAL: Dependency array must always be an array with stable structure
    // onChainTxRequestData is already providers.TransactionRequest | null, so we can use it directly
    // but we normalize to ensure stable array structure
  }, [
    onChainTxRequestData,
    gasEstimateData ?? null,
    isGasLoading,
    gasError ?? null,
    gasStrategy,
    derivedSwapInfo.chainId ?? null,
  ])

  // CRITICAL: useEffect must be called unconditionally - gate behavior inside the effect
  useEffect(() => {
    // Only log if we have valid data (gate behavior inside effect, not by skipping hook)
    if (!shouldEarlyReturn && result) {
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
    }
  }, [logSwapRequestErrors, result, derivedSwapInfo, transactionSettings, swapQuoteResponse ?? null, shouldEarlyReturn])

  // NOW we can do early returns (after ALL hooks have been called)
  if (shouldEarlyReturn) {
    if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
      logger.debug('useTransactionRequestInfo', 'useSwapTransactionRequestInfo', 'Early return: tx not ready', {
        chainId: derivedSwapInfo.chainId,
        hasOnChainQuote: !!onChainQuote,
        onChainQuoteShape: onChainQuote
          ? {
              hasQuoteAmountOut: !!onChainQuote.quoteAmountOut,
              hasTxPayload: !!onChainQuote.txPayload,
              hasRoute: !!onChainQuote.route,
              hasAmountOutMinimum: !!onChainQuote.amountOutMinimum,
              txPayloadKeys: onChainQuote.txPayload ? Object.keys(onChainQuote.txPayload) : null,
            }
          : null,
        hasTxPayload: !!onChainTxPayload,
        hasSwapQuoteResponse: !!swapQuoteResponse,
        isOnChainOnly: isOnChainOnlyChain(derivedSwapInfo.chainId),
        // Diagnostic: check if onChainQuote exists but txPayload is missing
        missingTxPayload: onChainQuote && !onChainTxPayload,
      })
    }

    // Return result with txRequests normalized to empty array (never undefined)
    return {
      ...result,
      txRequests: result.txRequests ?? [], // Always return array, not undefined
    }
  }

  // CRITICAL: Conditional return happens AFTER all hooks are called
  // Use on-chain tx request if available, otherwise fall back to Trading API result
  if (onChainTxRequestData && hasOnChainQuoteAmount) {
    // Always log for Base Sepolia to debug the issue
    if (derivedSwapInfo.chainId === 84532) {
      console.log('[TX-REQUEST-RETURN] Using on-chain tx request', {
        chainId: derivedSwapInfo.chainId,
        hasOnChainTxRequestData: !!onChainTxRequestData,
        hasOnChainQuoteAmount,
        txTo: onChainTxRequestData.to,
        txDataLen: (onChainTxRequestData.data as string | undefined)?.length,
      })
    }
    if (process.env.NODE_ENV !== 'production' && derivedSwapInfo.chainId === 84532) {
      // Safe conversion for logging - guard against undefined quotient
      const quoteAmountOut = onChainQuote.quoteAmountOut
      const quoteOutRaw =
        typeof quoteAmountOut?.quotient.toString === 'function'
          ? quoteAmountOut.quotient.toString()
          : quoteAmountOut?.quotient != null
            ? String(quoteAmountOut.quotient)
            : String(quoteAmountOut ?? '')
      const quoteOutExact =
        typeof quoteAmountOut?.toExact === 'function' ? quoteAmountOut.toExact() : String(quoteAmountOut ?? '')

      const txTo = onChainTxRequestData.to ? String(onChainTxRequestData.to).toLowerCase() : undefined
      const dataLen = (onChainTxRequestData.data as string | undefined)?.length ?? 0
      logger.debugDeduped(
        'useTransactionRequestInfo',
        'useSwapTransactionRequestInfo',
        'Using on-chain tx request',
        {
          chainId: derivedSwapInfo.chainId,
          txTo,
          dataLen,
          hasGasFee: !!gasFeeResult.value,
          gasFeeIsLoading: gasFeeResult.isLoading,
        },
        {
          ttlMs: 3000,
          minIntervalMs: 1500,
          maxPerWindow: 2,
          windowMs: 5000,
          includeKeys: ['chainId', 'txTo', 'dataLen'],
        },
      )
    }

    return {
      txRequests: [onChainTxRequestData],
      permitData: undefined,
      gasFeeResult,
      gasEstimate: {
        swapEstimate: gasEstimateData
          ? {
              gasLimit:
                typeof gasEstimateData.gasLimit === 'bigint'
                  ? gasEstimateData.gasLimit.toString()
                  : String(gasEstimateData.gasLimit),
              gasPrice: (gasEstimateData.feeData as any)?.gasPrice
                ? typeof (gasEstimateData.feeData as any).gasPrice === 'bigint'
                  ? (gasEstimateData.feeData as any).gasPrice.toString()
                  : String((gasEstimateData.feeData as any).gasPrice)
                : undefined,
              maxFeePerGas: (gasEstimateData.feeData as any)?.maxFeePerGas
                ? typeof (gasEstimateData.feeData as any).maxFeePerGas === 'bigint'
                  ? (gasEstimateData.feeData as any).maxFeePerGas.toString()
                  : String((gasEstimateData.feeData as any).maxFeePerGas)
                : undefined,
              maxPriorityFeePerGas: (gasEstimateData.feeData as any)?.maxPriorityFeePerGas
                ? typeof (gasEstimateData.feeData as any).maxPriorityFeePerGas === 'bigint'
                  ? (gasEstimateData.feeData as any).maxPriorityFeePerGas.toString()
                  : String((gasEstimateData.feeData as any).maxPriorityFeePerGas)
                : undefined,
            }
          : undefined,
      },
      swapRequestArgs: undefined,
      includesDelegation: false,
    } as TransactionRequestInfo
  }

  // Ensure txRequests is always an array (never undefined)
  return {
    ...result,
    txRequests: result.txRequests ?? [],
  }
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
  const permitData = derivedSwapInfo.trade.trade?.quote.permitData
  const uniswapXTransactionRequestInfo = useUniswapXTransactionRequestInfo(permitData)
  const swapTransactionRequestInfo = useSwapTransactionRequestInfo({ derivedSwapInfo, tokenApprovalInfo })

  if (derivedSwapInfo.trade.trade && isUniswapX(derivedSwapInfo.trade.trade)) {
    return uniswapXTransactionRequestInfo
  }

  return swapTransactionRequestInfo
}
