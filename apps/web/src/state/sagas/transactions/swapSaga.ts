import { useTotalBalancesUsdForAnalytics } from 'appGraphql/data/apollo/useTotalBalancesUsdForAnalytics'
import { TradingApi } from '@universe/api'
import { Experiments } from '@universe/gating'
import { popupRegistry } from 'components/Popups/registry'
import { PopupType } from 'components/Popups/types'
import { DEFAULT_TXN_DISMISS_MS, L2_TXN_DISMISS_MS, ZERO_PERCENT } from 'constants/misc'
import { useAccount } from 'hooks/useAccount'
import useSelectChain from 'hooks/useSelectChain'
import { formatSwapSignedAnalyticsEventProperties } from 'lib/utils/analytics'
import { useSetOverrideOneClickSwapFlag } from 'pages/Swap/settings/OneClickSwap'
import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { handleAtomicSendCalls } from 'state/sagas/transactions/5792'
import { useGetOnPressRetry } from 'state/sagas/transactions/retry'
import { jupiterSwap } from 'state/sagas/transactions/solana'
import { handleUniswapXPlanSignatureStep, handleUniswapXSignatureStep } from 'state/sagas/transactions/uniswapx'
import {
  getDisplayableError,
  getSwapTransactionInfo,
  handleApprovalTransactionStep,
  handleOnChainStep,
  handlePermitTransactionStep,
  handleSignatureStep,
} from 'state/sagas/transactions/utils'
import { VitalTxFields } from 'state/transactions/types'
import { call, SagaGenerator } from 'typed-redux-saga'
import { isL2ChainId } from 'uniswap/src/features/chains/utils'
import type { TransactionEip1559FeeParams, TransactionLegacyFeeParams } from 'uniswap/src/features/gas/types'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { isSVMChain } from 'uniswap/src/features/platforms/utils/chains'
import { SwapEventName } from 'uniswap/src/features/telemetry/constants'
import { sendAnalyticsEvent } from 'uniswap/src/features/telemetry/send'
import { SwapTradeBaseProperties } from 'uniswap/src/features/telemetry/types'
import { logExperimentQualifyingEvent } from 'uniswap/src/features/telemetry/utils/logExperimentQualifyingEvent'
import { selectSwapStartTimestamp } from 'uniswap/src/features/timing/selectors'
import { updateSwapStartTimestamp } from 'uniswap/src/features/timing/slice'
import { UnexpectedTransactionStateError } from 'uniswap/src/features/transactions/errors'
import {
  HandleOnChainStepParams,
  HandleSwapStepParams,
  TransactionStep,
  TransactionStepType,
} from 'uniswap/src/features/transactions/steps/types'
import {
  ExtractedBaseTradeAnalyticsProperties,
  getBaseTradeAnalyticsProperties,
} from 'uniswap/src/features/transactions/swap/analytics'
import { getFlashblocksExperimentStatus } from 'uniswap/src/features/transactions/swap/hooks/useIsUnichainFlashblocksEnabled'
import { useV4SwapEnabled } from 'uniswap/src/features/transactions/swap/hooks/useV4SwapEnabled'
import { planSaga } from 'uniswap/src/features/transactions/swap/plan/planSaga'
import { handleSwitchChains } from 'uniswap/src/features/transactions/swap/plan/utils'
import { getSwapTxRequest, SwapTransactionStepBatched } from 'uniswap/src/features/transactions/swap/steps/swap'
import { useSwapFormStore } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import {
  SwapCallback,
  SwapCallbackParams,
  SwapExecutionCallbacks,
} from 'uniswap/src/features/transactions/swap/types/swapCallback'
import {
  PermitMethod,
  ValidatedSwapTxContext,
  validateSwapTxContextWithReasons,
} from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { BridgeTrade, ChainedActionTrade, ClassicTrade } from 'uniswap/src/features/transactions/swap/types/trade'
import { estimateGasFee } from 'uniswap/src/features/transactions/swap/utils/estimateGasFee'
import { slippageToleranceToPercent } from 'uniswap/src/features/transactions/swap/utils/format'
import { generateSwapTransactionSteps } from 'uniswap/src/features/transactions/swap/utils/generateSwapTransactionSteps'
import {
  isClassic,
  isJupiter,
  requireRouting,
  UNISWAPX_ROUTING_VARIANTS,
} from 'uniswap/src/features/transactions/swap/utils/routing'
import { getClassicQuoteFromResponse } from 'uniswap/src/features/transactions/swap/utils/tradingApi'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import {
  isSignerMnemonicAccountDetails,
  SignerMnemonicAccountDetails,
} from 'uniswap/src/features/wallet/types/AccountDetails'
import { boundaryLog, boundaryLogDeduped } from 'uniswap/src/utils/boundaryLog'
import { createSaga } from 'uniswap/src/utils/saga'
import { logger } from 'utilities/src/logger/logger'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'

function* handleSwapTransactionStep(params: HandleSwapStepParams): SagaGenerator<string> {
  const { trade, step, signature, analytics, onTransactionHash } = params

  const chainId = trade.inputAmount.currency.chainId

  // eslint-disable-next-line no-console
  console.log('[SWAP-SAGA] calling-submitTransaction', {
    chainId,
    stepType: step.type,
    address: params.address,
  })

  const info = getSwapTransactionInfo({
    trade,
    isFinalStep: analytics.is_final_step,
    swapStartTimestamp: analytics.swap_start_timestamp,
  })
  const txRequest = yield* call(getSwapTxRequest, step, signature)

  const onModification = ({ hash, data }: VitalTxFields) => {
    sendAnalyticsEvent(SwapEventName.SwapModifiedInWallet, {
      ...analytics,
      txHash: hash,
      expected: txRequest.data?.toString() ?? '',
      actual: data,
    })
  }

  // Now that we have the txRequest, we can create a definitive SwapTransactionStep, incase we started with an async step.
  const onChainStep = { ...step, txRequest }

  // eslint-disable-next-line no-console
  console.log('[SWAP-SAGA] calling-handleOnChainStep', {
    chainId,
    stepType: onChainStep.type,
    address: params.address,
    to: onChainStep.txRequest.to,
    dataLen: (onChainStep.txRequest.data as string | undefined)?.length,
  })

  const hash = yield* call(handleOnChainStep, {
    ...params,
    info,
    step: onChainStep,
    ignoreInterrupt: true, // We avoid interruption during the swap step, since it is too late to give user a new trade once the swap is submitted.
    shouldWaitForConfirmation: false,
    onModification,
  })

  handleSwapTransactionAnalytics({ ...params, hash })

  const { shouldLogQualifyingEvent, shouldShowModal } = getFlashblocksExperimentStatus({
    chainId,
    routing: trade.routing,
  })

  if (shouldLogQualifyingEvent) {
    logExperimentQualifyingEvent({
      experiment: Experiments.UnichainFlashblocksModal,
    })
  }

  // Show regular popup for control variant or ineligible swaps
  if (!shouldShowModal) {
    popupRegistry.addPopup(
      { type: PopupType.Transaction, hash },
      hash,
      isL2ChainId(chainId) ? L2_TXN_DISMISS_MS : DEFAULT_TXN_DISMISS_MS,
    )
  }

  // Update swap form store with actual transaction hash
  if (onTransactionHash) {
    onTransactionHash(hash)
  }

  return hash
}

interface HandleSwapBatchedStepParams extends Omit<HandleOnChainStepParams, 'step' | 'info'> {
  step: SwapTransactionStepBatched
  trade: ClassicTrade | BridgeTrade
  analytics: SwapTradeBaseProperties
  disableOneClickSwap: () => void
}
function* handleSwapTransactionBatchedStep(params: HandleSwapBatchedStepParams) {
  const { trade, step, disableOneClickSwap, analytics } = params

  const info = getSwapTransactionInfo({
    trade,
    swapStartTimestamp: analytics.swap_start_timestamp,
  })

  const batchId = yield* handleAtomicSendCalls({
    ...params,
    info,
    step,
    ignoreInterrupt: true, // We avoid interruption during the swap step, since it is too late to give user a new trade once the swap is submitted.
    shouldWaitForConfirmation: false,
    disableOneClickSwap,
  })
  handleSwapTransactionAnalytics({ ...params, batchId })

  popupRegistry.addPopup({ type: PopupType.Transaction, hash: batchId }, batchId)

  return
}

function handleSwapTransactionAnalytics(params: {
  trade: ClassicTrade | BridgeTrade | ChainedActionTrade
  analytics: SwapTradeBaseProperties
  hash?: string
  batchId?: string
}) {
  const { trade, analytics, hash, batchId } = params

  sendAnalyticsEvent(
    SwapEventName.SwapSigned,
    formatSwapSignedAnalyticsEventProperties({
      trade,
      allowedSlippage: trade.slippageTolerance ? slippageToleranceToPercent(trade.slippageTolerance) : ZERO_PERCENT,
      fiatValues: {
        amountIn: analytics.token_in_amount_usd,
        amountOut: analytics.token_out_amount_usd,
        feeUsd: analytics.fee_usd,
      },
      txHash: hash,
      portfolioBalanceUsd: analytics.total_balances_usd,
      trace: analytics,
      isBatched: Boolean(batchId),
      includedPermitTransactionStep: analytics.included_permit_transaction_step,
      batchId,
      planId: analytics.plan_id,
      stepIndex: analytics.step_index,
    }),
  )
}

type SwapParams = SwapExecutionCallbacks & {
  selectChain: (chainId: number) => Promise<boolean>
  startChainId?: number
  account: SignerMnemonicAccountDetails
  analytics: ExtractedBaseTradeAnalyticsProperties
  swapTxContext: ValidatedSwapTxContext
  getOnPressRetry: (error: Error | undefined) => (() => void) | undefined
  // TODO(WEB-7763): Upgrade jotai to v2 to avoid need for prop drilling `disableOneClickSwap`
  disableOneClickSwap: () => void
  onTransactionHash?: (hash: string) => void
  v4Enabled: boolean
  swapStartTimestamp?: number
}

function* swap(params: SwapParams) {
  const {
    account,
    disableOneClickSwap,
    setCurrentStep,
    swapTxContext,
    analytics,
    onSuccess,
    onFailure,
    v4Enabled,
    setSteps,
  } = params
  const { trade } = swapTxContext

  const chainId = trade.inputAmount.currency.chainId
  const txRequests = (swapTxContext as any)?.txRequests
  const firstTxRequest = txRequests?.[0]
  const routing = trade.routing ? String(trade.routing) : undefined
  const indicative = (trade as any)?.indicative ?? false

  // Single unmissable trace: Saga handler entry
  boundaryLog(
    '[SWAP-SAGA] handler-enter',
    {
      tags: { file: 'swapSaga', function: 'swap' },
      extra: {
        chainId,
        routing,
        indicative,
        hasTrade: !!trade,
        hasTxRequests: !!(swapTxContext as any)?.txRequests,
        txRequestsLength: (swapTxContext as any)?.txRequests?.length ?? 0,
        swapTxContextKeys: swapTxContext ? Object.keys(swapTxContext as any) : [],
      },
    },
    chainId,
  )

  // eslint-disable-next-line no-console
  console.log('[SWAP-SAGA] ENTER', {
    chainId,
    accountAddress: account.address,
    txRequestTo: firstTxRequest?.to,
    txRequestValue: firstTxRequest?.value,
    txRequestDataLen: (firstTxRequest?.data as string | undefined)?.length,
    routing: trade.routing ? String(trade.routing) : undefined,
  })

  // Comprehensive params dump for debugging
  // eslint-disable-next-line no-console
  console.log('[SWAP-SAGA] PARAMS-SHAPE', {
    chainId,
    accountAddress: account.address,
    routing: trade.routing ? String(trade.routing) : undefined,
    indicative: (trade as any).indicative ?? false,
    keys: Object.keys(params ?? {}),
    hasTxRequest: !!firstTxRequest,
    txRequestTo: firstTxRequest?.to,
    txRequestDataLen: (firstTxRequest?.data as string | undefined)?.length,
    txRequestValue: firstTxRequest?.value,
    hasTrade: !!trade,
    tradeKeys: trade ? Object.keys(trade) : null,
    hasAllowedSlippage: trade.slippageTolerance != null,
    allowedSlippage: trade.slippageTolerance,
    hasRequestId: !!(
      (params as any)?.requestId ??
      (params as any)?.swapQuoteResponse?.requestId ??
      (params as any)?.quote?.requestId ??
      trade.quote.requestId
    ),
    requestId:
      (params as any)?.requestId ??
      (params as any)?.swapQuoteResponse?.requestId ??
      (params as any)?.quote?.requestId ??
      trade.quote.requestId,
    hasConnectorName: !!(account as any)?.connector?.name,
    connectorName: (account as any)?.connector?.name,
    hasPermit: !!(swapTxContext as any)?.permit,
    permitMethod: (swapTxContext as any)?.permit?.method,
    hasApprovalTx: !!(swapTxContext as any)?.approveTxRequest,
    hasRevokeTx: !!(swapTxContext as any)?.revocationTxRequest,
    swapTxContextKeys: swapTxContext ? Object.keys(swapTxContext) : null,
  })

  try {
    const { chainSwitchFailed } = yield* call(handleSwitchChains, {
      selectChain: params.selectChain,
      startChainId: params.startChainId,
      swapTxContext,
    })
    if (chainSwitchFailed) {
      // eslint-disable-next-line no-console
      console.log('[SWAP-SAGA] EARLY-RETURN', {
        reason: 'CHAIN_SWITCH_FAILED',
        chainId,
        accountAddress: account.address,
        startChainId: params.startChainId,
      })
      onFailure()
      return
    }

    // Log inputs before calling generateSwapTransactionSteps
    const txRequests = (swapTxContext as any)?.txRequests
    const firstTxRequest = txRequests?.[0]
    const trade = swapTxContext.trade
    const quote = (trade as any)?.quote
    const swapQuoteResponse = (params as any)?.swapQuoteResponse

    // eslint-disable-next-line no-console
    console.log('[SWAP-SAGA] STEPS-INPUT', {
      chainId,
      accountAddress: account.address,
      routing: trade.routing ? String(trade.routing) : undefined,
      indicative: (trade as any)?.indicative ?? false,
      hasTxRequest: !!firstTxRequest,
      txTo: firstTxRequest?.to,
      dataLen: (firstTxRequest?.data as string | undefined)?.length,
      hasTrade: !!trade,
      tradeKeys: trade ? Object.keys(trade) : null,
      hasSwapQuoteResponse: !!swapQuoteResponse,
      swapQuoteKeys: swapQuoteResponse ? Object.keys(swapQuoteResponse) : null,
      hasQuote: !!quote,
      quoteKeys: quote ? Object.keys(quote) : null,
      requestId:
        (params as any)?.requestId ??
        swapQuoteResponse?.requestId ??
        quote?.requestId ??
        (trade as any)?.quote?.requestId,
      hasAllowedSlippage: trade.slippageTolerance != null,
      allowedSlippage: trade.slippageTolerance,
      hasApproveTxRequest: !!(swapTxContext as any)?.approveTxRequest,
      hasRevocationTxRequest: !!(swapTxContext as any)?.revocationTxRequest,
      hasPermit: !!(swapTxContext as any)?.permit,
      permitMethod: (swapTxContext as any)?.permit?.method,
      txRequestsLength: txRequests?.length ?? 0,
      swapTxContextKeys: swapTxContext ? Object.keys(swapTxContext) : null,
    })

    // Pre-validate and fix gasFee if invalid (Base Sepolia only)
    let normalizedSwapTxContext = swapTxContext
    if (chainId === 84532) {
      const preValidation = validateSwapTxContextWithReasons(swapTxContext)
      const reasonsString = preValidation.reasons.join('|')

      boundaryLog(
        '[SWAP-SAGA] pre-validate',
        {
          tags: { file: 'swapSaga', function: 'swap' },
          extra: {
            chainId,
            reasonsString,
            ok: preValidation.ok,
          },
        },
        chainId,
      )

      // If INVALID_GAS_FEE, attempt to repair by estimating gas
      if (!preValidation.ok && preValidation.reasons.includes('INVALID_GAS_FEE')) {
        const firstTxRequest = txRequests?.[0]
        if (firstTxRequest?.to && firstTxRequest?.data) {
          try {
            const gasEstimate: Awaited<ReturnType<typeof estimateGasFee>> = yield* call(estimateGasFee, {
              chainId,
              txRequest: {
                to: firstTxRequest.to,
                data: firstTxRequest.data as string,
                value: firstTxRequest.value,
              },
              account: account.address,
            })

            // Build params object based on fee type
            let params: TransactionEip1559FeeParams | TransactionLegacyFeeParams | undefined
            if (gasEstimate.maxFeePerGas) {
              params = {
                maxFeePerGas: gasEstimate.maxFeePerGas.toString(),
                maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas?.toString() ?? '0',
                gasLimit: gasEstimate.gasLimit.toString(),
              } as TransactionEip1559FeeParams
            } else if (gasEstimate.gasPrice) {
              params = {
                gasPrice: gasEstimate.gasPrice.toString(),
                gasLimit: gasEstimate.gasLimit.toString(),
              } as TransactionLegacyFeeParams
            }

            // Create normalized context with estimated gasFee (matching ValidatedGasFeeResult shape)
            normalizedSwapTxContext = {
              ...swapTxContext,
              gasFee: {
                ...swapTxContext.gasFee,
                value: gasEstimate.totalCostWei.toString(), // string, not bigint
                error: null, // must be null for validation
                params, // include params for completeness
                isLoading: false,
              },
            } as typeof swapTxContext

            // Re-validate the patched context
            const postValidation = validateSwapTxContextWithReasons(normalizedSwapTxContext)
            const postReasonsString = postValidation.reasons.join('|')

            boundaryLog(
              '[SWAP-SAGA] gas-fee-repair-attempt',
              {
                tags: { file: 'swapSaga', function: 'swap' },
                extra: {
                  chainId,
                  estimationSource: gasEstimate.estimationSource,
                  totalCostWei: gasEstimate.totalCostWei.toString(),
                  gasLimit: gasEstimate.gasLimit.toString(),
                  maxFeePerGas: gasEstimate.maxFeePerGas?.toString(),
                  gasPrice: gasEstimate.gasPrice?.toString(),
                  hasParams: !!params,
                },
              },
              chainId,
            )

            boundaryLogDeduped(
              '[SWAP-SAGA] post-validate',
              {
                tags: { file: 'swapSaga', function: 'swap' },
                extra: {
                  chainId,
                  reasonsString: postReasonsString,
                  ok: postValidation.ok,
                  stillHasInvalidGasFee: postValidation.reasons.includes('INVALID_GAS_FEE'),
                },
              },
              chainId,
              {
                ttlMs: 5000,
                includeKeys: ['chainId', 'reasonsString', 'ok'],
              },
            )
          } catch (error: any) {
            // If estimation fails, set error and let validation fail normally
            normalizedSwapTxContext = {
              ...swapTxContext,
              gasFee: {
                ...swapTxContext.gasFee,
                error: error instanceof Error ? error : new Error(String(error)),
              },
            } as typeof swapTxContext

            boundaryLog(
              '[SWAP-SAGA] gas fee estimation failed',
              {
                tags: { file: 'swapSaga', function: 'swap' },
                extra: {
                  chainId,
                  error: error?.message,
                  stack: error?.stack,
                },
              },
              chainId,
            )
            // Continue - validation will catch the error
          }
        }
      }
    }

    // Single unmissable trace: About to call generateSwapTransactionSteps
    let steps: TransactionStep[]
    try {
      boundaryLog(
        '[SWAP-SAGA] calling generateSwapTransactionSteps',
        {
          tags: { file: 'swapSaga', function: 'swap' },
          extra: {
            chainId,
            routing,
            txRequestsLength: (normalizedSwapTxContext as any)?.txRequests?.length ?? 0,
            hasGasFeeValue: !!normalizedSwapTxContext.gasFee.value,
            gasFeeError: normalizedSwapTxContext.gasFee.error ? String(normalizedSwapTxContext.gasFee.error) : null,
          },
        },
        chainId,
      )

      steps = yield* call(generateSwapTransactionSteps, normalizedSwapTxContext, v4Enabled)

      boundaryLog(
        '[SWAP-SAGA] generateSwapTransactionSteps returned',
        {
          tags: { file: 'swapSaga', function: 'swap' },
          extra: {
            chainId,
            stepsLength: steps.length ?? 0,
            stepsTypes: steps.map((s: any) => s.type) ?? [],
          },
        },
        chainId,
      )

      // eslint-disable-next-line no-console
      console.log('[SWAP-SAGA] STEPS-OUTPUT', {
        stepsLength: steps.length ?? null,
        stepsTypes: steps.map((s) => s.type) ?? null,
      })
    } catch (e: any) {
      boundaryLog(
        '[SWAP-SAGA] generateSwapTransactionSteps threw',
        {
          tags: { file: 'swapSaga', function: 'swap' },
          extra: {
            chainId,
            message: e?.message,
            name: e?.name,
            stack: e?.stack,
          },
        },
        chainId,
      )
      const error = e instanceof Error ? e : new Error(String(e))
      // eslint-disable-next-line no-console
      console.error('[SWAP-SAGA] STEPS-THREW', {
        message: error.message,
        stack: error.stack,
        chainId,
        accountAddress: account.address,
      })
      throw e
    }

    setSteps(steps)

    // eslint-disable-next-line no-console
    console.log('[SWAP-SAGA] steps-generated', {
      chainId,
      accountAddress: account.address,
      stepsLength: steps.length ?? 0,
      stepsTypes: steps.map((s) => s.type) ?? [],
    })

    if (!steps || steps.length === 0) {
      // Get validation reasons to surface real error (not silent failure)
      const validation = validateSwapTxContextWithReasons(normalizedSwapTxContext)
      const firstReason = validation.reasons[0] || 'UNKNOWN'
      const reasonsString = validation.reasons.join('|')
      const errorMessage = `No transaction steps generated: ${firstReason}${reasonsString !== firstReason ? ` (${reasonsString})` : ''}`

      // eslint-disable-next-line no-console
      console.error('[SWAP-SAGA] NO_STEPS', {
        reason: 'NO_STEPS',
        chainId,
        accountAddress: account.address,
        stepsLength: steps.length ?? 0,
        firstReason,
        reasonsString,
        validationSnapshot: validation.snapshot,
      })

      // Surface blocking error with real reason
      const error = new Error(errorMessage)
      if (firstReason === 'INVALID_GAS_FEE') {
        // Include estimation error details if available
        const gasError = normalizedSwapTxContext.gasFee.error
        if (gasError) {
          let gasErrorMessage: string
          if (gasError instanceof Error) {
            gasErrorMessage = gasError.message
          } else if (typeof gasError === 'object' && gasError !== null && 'message' in gasError) {
            gasErrorMessage = String((gasError as { message: unknown }).message)
          } else {
            gasErrorMessage = String(gasError)
          }
          if (gasErrorMessage.includes('STF') || gasErrorMessage.includes('revert')) {
            error.message = `${errorMessage}. Gas estimation failed: ${gasErrorMessage.slice(0, 100)}`
          }
        }
      }
      onFailure(error)
      return
    }

    let signature: string | undefined
    let step: TransactionStep | undefined

    try {
      // TODO(SWAP-287): Integrate jupiter swap into TransactionStep, rather than special-casing.
      if (isJupiter(swapTxContext)) {
        // eslint-disable-next-line no-console
        console.log('[SWAP-SAGA] EARLY-RETURN', {
          reason: 'JUPITER_SWAP',
          chainId,
          accountAddress: account.address,
        })
        yield* call(jupiterSwap, { ...params, swapTxContext })
        yield* call(onSuccess)
        return
      }

      for (step of steps) {
        switch (step.type) {
          case TransactionStepType.TokenRevocationTransaction:
          case TransactionStepType.TokenApprovalTransaction: {
            yield* call(handleApprovalTransactionStep, { address: account.address, step, setCurrentStep })
            break
          }
          case TransactionStepType.Permit2Signature: {
            signature = yield* call(handleSignatureStep, { address: account.address, step, setCurrentStep })
            break
          }
          case TransactionStepType.Permit2Transaction: {
            yield* call(handlePermitTransactionStep, { address: account.address, step, setCurrentStep })
            break
          }
          case TransactionStepType.SwapTransaction:
          case TransactionStepType.SwapTransactionAsync: {
            requireRouting(trade, [TradingApi.Routing.CLASSIC, TradingApi.Routing.BRIDGE])

            // Log right before calling handleSwapTransactionStep
            const swapTxRequest = (step as any)?.txRequest
            // eslint-disable-next-line no-console
            console.log('[SWAP-SAGA] WILL-SEND', {
              chainId,
              accountAddress: account.address,
              stepType: step.type,
              to: swapTxRequest?.to,
              dataLen: (swapTxRequest?.data as string | undefined)?.length,
              value: swapTxRequest?.value,
              hasSignature: !!signature,
            })

            yield* call(handleSwapTransactionStep, {
              address: account.address,
              signature,
              step,
              setCurrentStep,
              trade,
              analytics,
              onTransactionHash: params.onTransactionHash,
            })
            break
          }
          case TransactionStepType.SwapTransactionBatched: {
            requireRouting(trade, [TradingApi.Routing.CLASSIC, TradingApi.Routing.BRIDGE])
            yield* call(handleSwapTransactionBatchedStep, {
              address: account.address,
              step,
              setCurrentStep,
              trade,
              analytics,
              disableOneClickSwap,
            })
            break
          }
          case TransactionStepType.UniswapXSignature: {
            requireRouting(trade, UNISWAPX_ROUTING_VARIANTS)
            yield* call(handleUniswapXSignatureStep, {
              address: account.address,
              step,
              setCurrentStep,
              trade,
              analytics,
            })
            break
          }
          default: {
            throw new UnexpectedTransactionStateError(`Unexpected step type: ${step.type}`)
          }
        }
      }

      // Log if we completed the loop without hitting a swap transaction step
      // eslint-disable-next-line no-console
      console.log('[SWAP-SAGA] steps-completed', {
        chainId,
        accountAddress: account.address,
        stepsProcessed: steps.length,
        hadSwapStep: steps.some(
          (s) =>
            s.type === TransactionStepType.SwapTransaction ||
            s.type === TransactionStepType.SwapTransactionAsync ||
            s.type === TransactionStepType.SwapTransactionBatched,
        ),
      })
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error))
      const shortStack = errorObj.stack?.split('\n').slice(0, 3).join('\n')

      // eslint-disable-next-line no-console
      console.error('[SWAP-SAGA] ERROR', {
        name: errorObj.name,
        message: errorObj.message,
        stackShort: shortStack,
        chainId: trade.inputAmount.currency.chainId,
      })

      const displayableError = getDisplayableError({ error, step })
      if (displayableError) {
        logger.error(displayableError, { tags: { file: 'swapSaga', function: 'swap' } })
      }
      const onPressRetry = params.getOnPressRetry(displayableError)
      onFailure(displayableError, onPressRetry)
      return
    }

    yield* call(onSuccess)
  } catch (error) {
    // Outer try-catch for handleSwitchChains and generateSwapTransactionSteps errors
    const errorObj = error instanceof Error ? error : new Error(String(error))
    const shortStack = errorObj.stack?.split('\n').slice(0, 3).join('\n')

    // eslint-disable-next-line no-console
    console.error('[SWAP-SAGA] OUTER ERROR', {
      name: errorObj.name,
      message: errorObj.message,
      stackShort: shortStack,
      chainId: trade.inputAmount.currency.chainId,
    })

    const displayableError = getDisplayableError({ error })
    if (displayableError) {
      logger.error(displayableError, { tags: { file: 'swapSaga', function: 'swap' } })
    }
    const onPressRetry = params.getOnPressRetry(displayableError)
    onFailure(displayableError, onPressRetry)
  }
}

export const swapSaga = createSaga(swap, 'swapSaga')

/** Callback to submit trades and track progress */
export function useSwapCallback(): SwapCallback {
  const appDispatch = useDispatch()
  const formatter = useLocalizationContext()
  const swapStartTimestamp = useSelector(selectSwapStartTimestamp)
  const selectChain = useSelectChain()
  const connectedAccount = useAccount()
  const startChainId = connectedAccount.chainId
  const v4SwapEnabled = useV4SwapEnabled(startChainId)
  const trace = useTrace()
  const updateSwapForm = useSwapFormStore((s) => s.updateSwapForm)

  const portfolioBalanceUsd = useTotalBalancesUsdForAnalytics()

  const disableOneClickSwap = useSetOverrideOneClickSwapFlag()
  const getOnPressRetry = useGetOnPressRetry()
  const wallet = useWallet()

  return useCallback(
    (args: SwapCallbackParams) => {
      const {
        swapTxContext,
        onSuccess,
        onFailure,
        currencyInAmountUSD,
        currencyOutAmountUSD,
        presetPercentage,
        preselectAsset,
        isAutoSlippage,
        isFiatInputMode,
        setCurrentStep,
        setSteps,
        onPending,
      } = args
      const { trade, gasFee } = swapTxContext

      const isClassicSwap = isClassic(swapTxContext)
      const isBatched = isClassicSwap && swapTxContext.txRequests && swapTxContext.txRequests.length > 1
      const includedPermitTransactionStep = isClassicSwap && swapTxContext.permit?.method === PermitMethod.Transaction

      // Defensive: analytics must never crash swap flow
      let analytics
      try {
        analytics = getBaseTradeAnalyticsProperties({
          formatter,
          trade,
          currencyInAmountUSD,
          currencyOutAmountUSD,
          presetPercentage,
          preselectAsset,
          portfolioBalanceUsd,
          trace,
          isBatched,
          includedPermitTransactionStep,
          swapStartTimestamp,
        })
      } catch (error) {
        // Log error and continue with minimal analytics
        const errorMessage = error instanceof Error ? error.message : String(error)
        // eslint-disable-next-line no-console
        console.log('[SWAP-SAGA] analytics-fallback', {
          chainId: trade.inputAmount.currency.chainId,
          errorMessage,
        })
        // Use empty object as fallback - swap continues without analytics
        analytics = {}
      }

      const account = isSVMChain(trade.inputAmount.currency.chainId) ? wallet.svmAccount : wallet.evmAccount

      if (!account || !isSignerMnemonicAccountDetails(account)) {
        throw new Error('No account found')
      }

      const swapParams = {
        swapTxContext,
        account,
        analytics,
        getOnPressRetry,
        disableOneClickSwap,
        onSuccess,
        onFailure,
        setCurrentStep,
        setSteps,
        selectChain,
        startChainId,
        v4Enabled: v4SwapEnabled,
        onPending,
        onTransactionHash: (hash: string): void => {
          updateSwapForm({ txHash: hash, txHashReceivedTime: Date.now() })
        },
        swapStartTimestamp,
      }

      const chainId = trade.inputAmount.currency.chainId
      const txRequests = (swapTxContext as any)?.txRequests
      const firstTxRequest = txRequests?.[0]

      // eslint-disable-next-line no-console
      console.log('[SWAP-CALLBACK] dispatching-saga', {
        chainId,
        accountAddress: account.address,
        actionType:
          swapTxContext.trade.routing === TradingApi.Routing.CHAINED ? 'planSaga.trigger' : 'swapSaga.trigger',
        routing: trade.routing ? String(trade.routing) : undefined,
        txRequestTo: firstTxRequest?.to,
        txRequestDataLen: (firstTxRequest?.data as string | undefined)?.length,
        txRequestValue: firstTxRequest?.value,
      })

      if (swapTxContext.trade.routing === TradingApi.Routing.CHAINED) {
        appDispatch(
          planSaga.actions.trigger({
            ...swapParams,
            address: account.address,
            handleApprovalTransactionStep,
            handleSwapTransactionStep,
            handleSignatureStep,
            getDisplayableError,
            handleUniswapXPlanSignatureStep,
          }),
        )
      } else {
        appDispatch(swapSaga.actions.trigger(swapParams))
      }

      const blockNumber = getClassicQuoteFromResponse(trade.quote)?.blockNumber?.toString()

      sendAnalyticsEvent(SwapEventName.SwapSubmittedButtonClicked, {
        ...analytics,
        estimated_network_fee_wei: gasFee.value,
        gas_limit: isClassicSwap ? swapTxContext.txRequests?.[0]?.gasLimit?.toString() : undefined,
        transaction_deadline_seconds: trade.deadline,
        swap_quote_block_number: blockNumber,
        is_auto_slippage: isAutoSlippage,
        swap_flow_duration_milliseconds: swapStartTimestamp ? Date.now() - swapStartTimestamp : undefined,
        is_fiat_input_mode: isFiatInputMode,
      })

      // Reset swap start timestamp now that the swap has been submitted
      appDispatch(updateSwapStartTimestamp({ timestamp: undefined }))
    },
    [
      formatter,
      portfolioBalanceUsd,
      trace,
      selectChain,
      startChainId,
      v4SwapEnabled,
      appDispatch,
      swapStartTimestamp,
      getOnPressRetry,
      disableOneClickSwap,
      wallet.evmAccount,
      wallet.svmAccount,
      updateSwapForm,
    ],
  )
}
