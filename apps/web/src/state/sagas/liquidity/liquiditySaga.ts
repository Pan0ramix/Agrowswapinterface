import { BigNumber } from '@ethersproject/bignumber'
import {
  GetLPPriceDiscrepancyRequest,
  GetLPPriceDiscrepancyResponse,
} from '@uniswap/client-trading/dist/trading/v1/api_pb'
import { getLiquidityEventName } from 'components/Liquidity/analytics'
import { popupRegistry } from 'components/Popups/registry'
import { PopupType } from 'components/Popups/types'
import { timestampToDeadline } from 'hooks/useTransactionDeadline'
import { handleAtomicSendCalls } from 'state/sagas/transactions/5792'
import {
  getDisplayableError,
  getSigner,
  handleApprovalTransactionStep,
  handleOnChainStep,
  handlePermitTransactionStep,
  handleSignatureStep,
} from 'state/sagas/transactions/utils'
import type { InterfaceState } from 'state/webReducer'
import invariant from 'tiny-invariant'
import type { SagaGenerator } from 'typed-redux-saga'
import { call, delay, select, spawn } from 'typed-redux-saga'
import { ZERO_ADDRESS } from 'uniswap/src/constants/misc'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { InterfaceEventName, LiquidityEventName } from 'uniswap/src/features/telemetry/constants'
import { sendAnalyticsEvent } from 'uniswap/src/features/telemetry/send'
import type { UniverseEventProperties } from 'uniswap/src/features/telemetry/types'
import type { CollectFeesTransactionStep } from 'uniswap/src/features/transactions/liquidity/steps/collectFees'
import type { DecreasePositionTransactionStep } from 'uniswap/src/features/transactions/liquidity/steps/decreasePosition'
import { generateLPTransactionSteps } from 'uniswap/src/features/transactions/liquidity/steps/generateLPTransactionSteps'
import type {
  IncreasePositionTransactionStep,
  IncreasePositionTransactionStepAsync,
  IncreasePositionTransactionStepBatched,
} from 'uniswap/src/features/transactions/liquidity/steps/increasePosition'
import type {
  MigratePositionTransactionStep,
  MigratePositionTransactionStepAsync,
} from 'uniswap/src/features/transactions/liquidity/steps/migrate'
import type { LiquidityAction, ValidatedLiquidityTxContext } from 'uniswap/src/features/transactions/liquidity/types'
import { LiquidityTransactionType } from 'uniswap/src/features/transactions/liquidity/types'
import { updateMintDeadline } from 'uniswap/src/features/transactions/liquidity/utils/updateMintDeadline'
import type { HandleOnChainStepParams, TransactionStep } from 'uniswap/src/features/transactions/steps/types'
import { TransactionStepType } from 'uniswap/src/features/transactions/steps/types'
import type { SetCurrentStepFn } from 'uniswap/src/features/transactions/swap/types/swapCallback'
import type {
  CollectFeesTransactionInfo,
  CreatePoolTransactionInfo,
  LiquidityDecreaseTransactionInfo,
  LiquidityIncreaseTransactionInfo,
  MigrateV3LiquidityToV4TransactionInfo,
} from 'uniswap/src/features/transactions/types/transactionDetails'
import { TransactionType } from 'uniswap/src/features/transactions/types/transactionDetails'
import { SignerMnemonicAccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { currencyId, isNativeCurrencyAddress } from 'uniswap/src/utils/currencyId'
import { createSaga } from 'uniswap/src/utils/saga'
import { logger } from 'utilities/src/logger/logger'

type LiquidityParams = {
  selectChain: (chainId: number) => Promise<boolean>
  startChainId?: number
  account: SignerMnemonicAccountDetails
  analytics?:
    | Omit<UniverseEventProperties[LiquidityEventName.AddLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.RemoveLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.MigrateLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.CollectLiquiditySubmitted], 'transaction_hash'>
  liquidityTxContext: ValidatedLiquidityTxContext
  setCurrentStep: SetCurrentStepFn
  setSteps: (steps: TransactionStep[]) => void
  onSuccess: () => void
  onFailure: (e?: unknown) => void
  disableOneClickSwap?: () => void
}

/**
 * Compute deadline using Uniswap's shared deadline helper
 * This ensures LP mint deadlines are computed identically to swap deadlines
 *
 * TTL source: state.user.userDeadline (from Redux state, same as swaps)
 * - For L2 chains: timestampToDeadline uses L2_DEADLINE_FROM_NOW constant (300 seconds), ignoring ttl
 * - For L1 chains: timestampToDeadline uses ttl from user settings (can be undefined)
 * - Returns undefined if blockTimestamp or required TTL is missing (same behavior as swaps)
 *
 * This matches the exact behavior of useGetTransactionDeadline used by swaps.
 */
function* computeDeadlineForMint(chainId: number, accountAddress: string): SagaGenerator<number | undefined> {
  try {
    // Get user-configured TTL from Redux state (same source as swaps)
    // Pass ttl as-is (can be undefined) - timestampToDeadline handles it the same way swaps do
    // TTL source: state.user.userDeadline (initialized to DEFAULT_DEADLINE_FROM_NOW in reducer, but can be undefined)
    const ttl: number | undefined = yield* select((state: InterfaceState) => state.user.userDeadline)

    // Get current block timestamp (on-chain, not client time - same as swaps)
    // Use getSigner to access provider (same pattern as other saga functions)
    const signer = yield* call(getSigner, accountAddress)
    const block = yield* call([signer.provider, 'getBlock'], 'latest')
    const blockTimestamp = BigNumber.from(block.timestamp)

    // Use Uniswap's shared deadline helper (same as useGetTransactionDeadline)
    const deadline = timestampToDeadline({
      chainId,
      blockTimestamp,
      ttl,
    })

    if (!deadline) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[computeDeadlineForMint] Failed to compute deadline', {
          chainId,
          blockTimestamp: blockTimestamp.toString(),
          ttl,
        })
      }
      return undefined
    }

    // Convert BigNumber to number (deadline is in seconds)
    return deadline.toNumber()
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[computeDeadlineForMint] Error computing deadline', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined
  }
}

function* getLiquidityTxRequest(
  step:
    | IncreasePositionTransactionStep
    | IncreasePositionTransactionStepAsync
    | DecreasePositionTransactionStep
    | MigratePositionTransactionStep
    | MigratePositionTransactionStepAsync
    | CollectFeesTransactionStep,
  signature: string | undefined,
  accountAddress: string,
) {
  let txRequest: typeof step.txRequest
  let sqrtRatioX96: string | undefined

  if (
    step.type === TransactionStepType.IncreasePositionTransaction ||
    step.type === TransactionStepType.DecreasePositionTransaction
  ) {
    txRequest = step.txRequest
    sqrtRatioX96 = step.sqrtRatioX96
  } else if (
    step.type === TransactionStepType.MigratePositionTransaction ||
    step.type === TransactionStepType.CollectFeesTransactionStep
  ) {
    txRequest = step.txRequest
  } else {
    if (!signature) {
      throw new Error('Signature required for async increase position transaction step')
    }

    const result = yield* call(step.getTxRequest, signature)
    invariant(result.txRequest !== undefined, 'txRequest must be defined')
    txRequest = result.txRequest
    sqrtRatioX96 = result.sqrtRatioX96
  }

  // Update deadline in mint calldata if this is a V3 mint transaction
  // This ensures the deadline is always fresh when the transaction is actually sent,
  // following Uniswap's pattern of computing deadlines at submission time
  // Uses the same deadline computation as swaps (timestampToDeadline with user TTL from Redux)
  // TTL source: state.user.userDeadline (same as swaps)
  if (txRequest?.data && txRequest.data.startsWith('0x88316456') && txRequest.chainId) {
    const freshDeadline = yield* call(computeDeadlineForMint, txRequest.chainId, accountAddress)

    if (freshDeadline !== undefined) {
      const updatedData = updateMintDeadline(txRequest.data, freshDeadline)
      txRequest = {
        ...txRequest,
        data: updatedData,
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[getLiquidityTxRequest] Updated deadline in mint calldata', {
          chainId: txRequest.chainId,
          freshDeadline,
          calldataPrefix: txRequest.data.substring(0, 20),
        })
      }
    } else if (process.env.NODE_ENV !== 'production') {
      console.warn('[getLiquidityTxRequest] Could not compute fresh deadline, using original calldata', {
        chainId: txRequest.chainId,
      })
    }
  }

  return { txRequest, sqrtRatioX96 }
}

interface HandlePositionStepParams extends Omit<HandleOnChainStepParams, 'step' | 'info'> {
  step:
    | IncreasePositionTransactionStep
    | IncreasePositionTransactionStepAsync
    | DecreasePositionTransactionStep
    | MigratePositionTransactionStep
    | MigratePositionTransactionStepAsync
    | CollectFeesTransactionStep
  signature?: string
  action: LiquidityAction
  analytics?:
    | Omit<UniverseEventProperties[LiquidityEventName.AddLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.RemoveLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.MigrateLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.CollectLiquiditySubmitted], 'transaction_hash'>
}
function* handlePositionTransactionStep(params: HandlePositionStepParams) {
  const { action, step, signature, analytics, address } = params
  const info = getLiquidityTransactionInfo(action)
  const { txRequest, sqrtRatioX96 } = yield* call(getLiquidityTxRequest, step, signature, address)

  const onModification = ({ hash, data }: { hash: string; data: string }) => {
    if (analytics) {
      sendAnalyticsEvent(LiquidityEventName.TransactionModifiedInWallet, {
        ...analytics,
        transaction_hash: hash,
        expected: txRequest.data?.toString(),
        actual: data,
      })
    }
  }

  // Now that we have the txRequest, we can create a definitive LiquidityTransactionStep, incase we started with an async step.
  const onChainStep = { ...step, txRequest }
  let hash: string | undefined
  try {
    hash = yield* call(handleOnChainStep, {
      ...params,
      info,
      step: onChainStep,
      shouldWaitForConfirmation: false,
      onModification,
    })
  } catch (e) {
    if (analytics) {
      sendAnalyticsEvent(InterfaceEventName.OnChainAddLiquidityFailed, {
        ...analytics,
        message: e.message,
      })
    }

    throw e
  }

  if (analytics) {
    sendAnalyticsEvent(getLiquidityEventName(onChainStep.type), {
      ...analytics,
      transaction_hash: hash,
    } satisfies
      | UniverseEventProperties[LiquidityEventName.AddLiquiditySubmitted]
      | UniverseEventProperties[LiquidityEventName.RemoveLiquiditySubmitted]
      | UniverseEventProperties[LiquidityEventName.MigrateLiquiditySubmitted]
      | UniverseEventProperties[LiquidityEventName.CollectLiquiditySubmitted])

    // Don't block the main flow, spawn a new task for polling LP price discrepancy
    yield* spawn(function* () {
      if (hash && sqrtRatioX96 && txRequest.chainId === UniverseChainId.Mainnet) {
        try {
          const priceDiscrepancyResponse: GetLPPriceDiscrepancyResponse = yield* call(pollForLPPriceDiscrepancy, {
            hash,
            chainId: txRequest.chainId,
            sqrtRatioX96,
            analytics,
          })

          sendAnalyticsEvent(LiquidityEventName.PriceDiscrepancyChecked, {
            ...analytics,
            event_name: getLiquidityEventName(onChainStep.type),
            transaction_hash: hash,
            status: priceDiscrepancyResponse.status,
            sqrt_ratio_x96_before: priceDiscrepancyResponse.sqrtRatioX96Before,
            sqrt_ratio_x96_after: priceDiscrepancyResponse.sqrtRatioX96After,
            price_discrepancy: priceDiscrepancyResponse.percentPriceDifference,
            absolute_price_discrepancy: Math.abs(Number(priceDiscrepancyResponse.percentPriceDifference)),
          })
        } catch (error) {
          // Don't break the main flow if price discrepancy call fails
          logger.info('liquiditySaga', 'handlePositionTransactionStep', 'Failed to get LP price discrepancy', {
            extra: { hash, error: error.message },
          })
        }
      }
    })
  }

  popupRegistry.addPopup({ type: PopupType.Transaction, hash }, hash)
}

interface HandlePositionBatchedStepParams extends Omit<HandleOnChainStepParams, 'step' | 'info'> {
  step: IncreasePositionTransactionStepBatched
  disableOneClickSwap?: () => void
  action: LiquidityAction
  analytics?:
    | Omit<UniverseEventProperties[LiquidityEventName.AddLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.RemoveLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.MigrateLiquiditySubmitted], 'transaction_hash'>
    | Omit<UniverseEventProperties[LiquidityEventName.CollectLiquiditySubmitted], 'transaction_hash'>
}
function* handlePositionTransactionBatchedStep(params: HandlePositionBatchedStepParams) {
  const { action, step, analytics, disableOneClickSwap } = params

  const info = getLiquidityTransactionInfo(action)

  const batchId = yield* handleAtomicSendCalls({
    ...params,
    info,
    step,
    ignoreInterrupt: true,
    shouldWaitForConfirmation: false,
    disableOneClickSwap,
  })

  if (analytics) {
    sendAnalyticsEvent(getLiquidityEventName(TransactionStepType.IncreasePositionTransaction), {
      ...analytics,
      transaction_hash: batchId,
    } satisfies
      | UniverseEventProperties[LiquidityEventName.AddLiquiditySubmitted]
      | UniverseEventProperties[LiquidityEventName.RemoveLiquiditySubmitted]
      | UniverseEventProperties[LiquidityEventName.MigrateLiquiditySubmitted]
      | UniverseEventProperties[LiquidityEventName.CollectLiquiditySubmitted])
  }

  popupRegistry.addPopup({ type: PopupType.Transaction, hash: batchId }, batchId)
}

function* modifyLiquidity(params: LiquidityParams & { steps: TransactionStep[] }) {
  const {
    account,
    setCurrentStep,
    steps,
    liquidityTxContext: { action },
    onSuccess,
    onFailure,
    analytics,
    disableOneClickSwap,
  } = params

  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] modifyLiquidity started', {
      stepCount: steps.length,
      accountAddress: account.address,
      actionType: action.type,
    })
  }

  let signature: string | undefined

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[liquiditySaga] Processing step ${i + 1}/${steps.length}`, {
        stepType: step.type,
        hasTxRequest: 'txRequest' in step,
        txRequestChainId: 'txRequest' in step ? step.txRequest.chainId : undefined,
        txRequestTo: 'txRequest' in step ? step.txRequest.to : undefined,
      })
    }

    try {
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
        case TransactionStepType.IncreasePositionTransaction:
        case TransactionStepType.IncreasePositionTransactionAsync:
        case TransactionStepType.DecreasePositionTransaction:
        case TransactionStepType.MigratePositionTransaction:
        case TransactionStepType.MigratePositionTransactionAsync:
        case TransactionStepType.CollectFeesTransactionStep: {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[liquiditySaga] Executing position transaction step', {
              stepType: step.type,
              hasTxRequest: 'txRequest' in step,
              txRequest:
                'txRequest' in step
                  ? {
                      chainId: step.txRequest.chainId,
                      to: step.txRequest.to,
                      data: step.txRequest.data ? `${step.txRequest.data.substring(0, 20)}...` : undefined,
                      value: step.txRequest.value,
                    }
                  : undefined,
            })
          }
          yield* call(handlePositionTransactionStep, {
            address: account.address,
            step,
            setCurrentStep,
            action,
            signature,
            analytics,
            // For LP flows on custom chains, allow re-prompting even if a prior identical
            // transaction was recorded, to avoid suppressing the wallet prompt after
            // approval retries or modal reloads.
            allowDuplicativeTx: true,
          })
          if (process.env.NODE_ENV !== 'production') {
            console.log('[liquiditySaga] Position transaction step completed')
          }
          break
        }
        case TransactionStepType.IncreasePositionTransactionBatched:
          yield* call(handlePositionTransactionBatchedStep, {
            address: account.address,
            step,
            setCurrentStep,
            action,
            analytics,
            disableOneClickSwap,
          })
          break
        default: {
          throw new Error('Unexpected step type')
        }
      }
    } catch (e) {
      console.error(`[liquiditySaga] ERROR in step ${i + 1}/${steps.length}`, {
        stepType: step.type,
        error: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      })
      const displayableError = getDisplayableError({ error: e, step, flow: 'liquidity' })

      if (displayableError) {
        logger.error(displayableError, { tags: { file: 'liquiditySaga', function: 'modifyLiquidity' } })
        onFailure(e)
      } else {
        onFailure()
      }

      return
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] All steps completed successfully, calling onSuccess')
  }
  yield* call(onSuccess)
}

function* liquidity(params: LiquidityParams) {
  const { liquidityTxContext, selectChain, onFailure } = params

  // Derive startChainId from multiple sources in priority order:
  // 1. Currently connected wallet chain ID (from account) - HIGHEST PRIORITY
  // 2. Payload chainId if provided
  // 3. Transaction request chainId
  // 4. Token chainId (as final fallback, but don't force switch if we defaulted to this)
  const token0ChainId = liquidityTxContext.action.currency0Amount.currency.chainId
  const token1ChainId = liquidityTxContext.action.currency1Amount.currency.chainId
  const txRequestChainId = liquidityTxContext.txRequest?.chainId

  // Priority order: account.chainId > startChainId > txRequest.chainId > token0.chainId
  const startChainId: UniverseChainId | undefined =
    params.account.chainId ?? params.startChainId ?? txRequestChainId ?? token0ChainId

  // Track if we defaulted to token chainId (meaning we have no real wallet connection info)
  const isDefaultedToTokenChain = !params.account.chainId && !params.startChainId && !txRequestChainId

  // Debug logging (development only)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] Chain detection', {
      accountChainId: params.account.chainId,
      payloadChainId: params.startChainId,
      txRequestChainId,
      token0ChainId,
      token1ChainId,
      derivedStartChainId: startChainId,
      isDefaultedToTokenChain,
    })
  }

  // Debug logging (development only)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] Saga triggered', {
      liquidityTxContextType: liquidityTxContext.type,
      hasTxRequest: !!liquidityTxContext.txRequest,
      txRequestChainId,
      startChainId,
      accountAddress: params.account.address,
      currency0: liquidityTxContext.action.currency0Amount.currency.symbol,
      currency1: liquidityTxContext.action.currency1Amount.currency.symbol,
    })
  }

  const steps = yield* call(generateLPTransactionSteps, liquidityTxContext)

  // Debug logging (development only)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] Generated transaction steps', {
      stepCount: steps.length,
      stepTypes: steps.map((s) => s.type),
      hasOnChainSteps: steps.some((s) => 'txRequest' in s),
    })
  }
  params.setSteps(steps)

  // Validate tokens are on the same chain
  if (token0ChainId !== token1ChainId) {
    console.error('[liquiditySaga] ERROR: Tokens must be on the same chain', {
      token0ChainId,
      token1ChainId,
    })
    logger.error('Tokens must be on the same chain', {
      tags: { file: 'liquiditySaga', function: 'liquidity' },
    })
    onFailure()
    return undefined
  }

  // Determine target chain (use token chain as source of truth)
  const targetChainId = token0ChainId

  // Determine if chain switch is needed:
  // Chain switch should only occur when ALL of these are true:
  // 1. We didn't default to token chain (have real wallet connection info)
  // 2. startChainId is defined (we know the current chain)
  // 3. targetChainId is defined (we know the target chain)
  // 4. startChainId differs from targetChainId (actually need to switch)
  const needsChainSwitch =
    !isDefaultedToTokenChain &&
    startChainId !== undefined &&
    targetChainId !== undefined &&
    startChainId !== targetChainId

  // Debug logging (development only)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] Chain switch evaluation', {
      startChainId,
      targetChainId,
      isDefaultedToTokenChain,
      needsChainSwitch,
      reason: isDefaultedToTokenChain
        ? 'No wallet connection info - will prompt on tx send'
        : startChainId === targetChainId
          ? 'Already on target chain'
          : startChainId === undefined || targetChainId === undefined
            ? 'Missing chain info'
            : 'Chain switch required',
    })
  }

  // Only attempt chain switch if we have a real startChainId and it differs from target
  if (needsChainSwitch) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[liquiditySaga] Switching chain', {
        from: startChainId,
        to: targetChainId,
      })
    }
    const chainSwitched = yield* call(selectChain, targetChainId)
    if (!chainSwitched) {
      logger.error('Failed to switch chain', {
        tags: { file: 'liquiditySaga', function: 'liquidity' },
        extra: { from: startChainId, targetChainId },
      })
      onFailure()
      return undefined
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[liquiditySaga] Chain switch successful')
    }
  } else if (isDefaultedToTokenChain && process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] Skipping chain switch - no wallet connection info available')
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[liquiditySaga] Proceeding to modifyLiquidity', {
      stepCount: steps.length,
    })
  }

  return yield* modifyLiquidity({
    ...params,
    steps,
  })
}

export const liquiditySaga = createSaga(liquidity, 'liquiditySaga')

function getLiquidityTransactionInfo(
  action: LiquidityAction,
):
  | LiquidityIncreaseTransactionInfo
  | LiquidityDecreaseTransactionInfo
  | MigrateV3LiquidityToV4TransactionInfo
  | CreatePoolTransactionInfo
  | CollectFeesTransactionInfo {
  let type: TransactionType
  switch (action.type) {
    case LiquidityTransactionType.Create:
      type = TransactionType.CreatePool
      break
    case LiquidityTransactionType.Increase:
      type = TransactionType.LiquidityIncrease
      break
    case LiquidityTransactionType.Decrease:
      type = TransactionType.LiquidityDecrease
      break
    case LiquidityTransactionType.Migrate:
      type = TransactionType.MigrateLiquidityV3ToV4
      break
    case LiquidityTransactionType.Collect:
      type = TransactionType.CollectFees
  }

  const {
    currency0Amount: { currency: currency0, quotient: quotient0 },
    currency1Amount: { currency: currency1, quotient: quotient1 },
  } = action
  return {
    type,
    currency0Id: currencyId(currency0),
    currency1Id: currencyId(currency1),
    currency0AmountRaw: quotient0.toString(),
    currency1AmountRaw: quotient1.toString(),
  }
}

function* pollForLPPriceDiscrepancy(params: {
  hash: string
  chainId: number
  sqrtRatioX96: string
  analytics: NonNullable<HandlePositionStepParams['analytics']>
}) {
  const { hash, chainId, sqrtRatioX96, analytics } = params

  let attempt = 1
  const maxAttempts = 10
  const baseDelay = 2_000 // Start with 2 seconds
  const maxDelay = 15_000 // Cap at 15 seconds

  yield* delay(baseDelay)

  // Polling is required because the BE cannot wait for the transaction to be confirmed
  // without throwing a timeout error.
  while (attempt < maxAttempts) {
    try {
      const priceDiscrepancyResponse: GetLPPriceDiscrepancyResponse = yield* call(
        TradingApiClient.getLPPriceDiscrepancy,
        new GetLPPriceDiscrepancyRequest({
          txnHash: hash,
          chainId,
          token0: isNativeCurrencyAddress(chainId, analytics.baseCurrencyId) ? ZERO_ADDRESS : analytics.baseCurrencyId,
          token1: isNativeCurrencyAddress(chainId, analytics.quoteCurrencyId)
            ? ZERO_ADDRESS
            : analytics.quoteCurrencyId,
          tickSpacing: analytics.tick_spacing,
          fee: analytics.fee_tier,
          hooks: analytics.hook,
          sqrtRatioX96,
          // @ts-expect-error endpoint excepts a string
          protocol: analytics.type,
        }),
      )

      return priceDiscrepancyResponse
    } catch (error) {
      const errorMessage = JSON.stringify(error)

      // If it's not a "Transaction receipt not found" error, don't retry
      if (!errorMessage.includes('Transaction receipt not found')) {
        throw error
      }

      // If we've exhausted all attempts, throw the error
      if (attempt >= maxAttempts) {
        throw error
      }

      // Calculate exponential backoff delay
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)

      logger.info(
        'liquiditySaga',
        'pollForLPPriceDiscrepancy',
        `Transaction receipt not found, retrying in ${exponentialDelay}ms (attempt ${attempt + 1}/${maxAttempts})`,
        { extra: { hash } },
      )

      yield* delay(exponentialDelay)
      attempt++
    }
  }

  throw new Error('Max polling attempts reached')
}
