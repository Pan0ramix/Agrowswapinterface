/* eslint-disable max-lines */

import type {
  BridgeQuoteResponse,
  ClassicQuoteResponse,
  DiscriminatedQuoteResponse,
  GasEstimate,
  GasStrategy,
  UnwrapQuoteResponse,
  WrapQuoteResponse,
} from '@universe/api'
import { TradingApi } from '@universe/api'
import type { providers } from 'ethers/lib/ethers'
import { useMemo, useRef } from 'react'
import { getTradeSettingsDeadline } from 'uniswap/src/data/apiClients/tradingApi/utils/getTradeSettingsDeadline'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { convertGasFeeToDisplayValue, useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import type { GasFeeResult } from 'uniswap/src/features/gas/types'
import { SwapEventName } from 'uniswap/src/features/telemetry/constants'
import { sendAnalyticsEvent } from 'uniswap/src/features/telemetry/send'
import type { TransactionSettings } from 'uniswap/src/features/transactions/components/settings/types'
import { getBaseTradeAnalyticsPropertiesFromSwapInfo } from 'uniswap/src/features/transactions/swap/analytics'
import type { ApprovalTxInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import {
  SlippageTooLowError,
  UnknownSimulationError,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/constants'
import type { SwapData } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/evmSwapRepository'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { SolanaTrade } from 'uniswap/src/features/transactions/swap/types/solana'
import type {
  BaseSwapTxAndGasInfo,
  BridgeSwapTxAndGasInfo,
  ClassicSwapTxAndGasInfo,
  SwapGasFeeEstimation,
  WrapSwapTxAndGasInfo,
} from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { PermitMethod } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import type {
  BridgeTrade,
  ClassicTrade,
  TokenApprovalInfo,
  UnwrapTrade,
  WrapTrade,
} from 'uniswap/src/features/transactions/swap/types/trade'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { mergeGasFeeResults } from 'uniswap/src/features/transactions/swap/utils/gas'
import { isClassic } from 'uniswap/src/features/transactions/swap/utils/routing'
import {
  validatePermit,
  validateTransactionRequest,
  validateTransactionRequests,
} from 'uniswap/src/features/transactions/swap/utils/trade'
import { SWAP_GAS_URGENCY_OVERRIDE } from 'uniswap/src/features/transactions/swap/utils/tradingApi'
import type { ValidatedTransactionRequest } from 'uniswap/src/features/transactions/types/transactionRequests'
import { CurrencyField } from 'uniswap/src/types/currency'
import { logger } from 'utilities/src/logger/logger'
import { isExtensionApp, isMobileApp, isWebApp } from 'utilities/src/platform'
import type { ITraceContext } from 'utilities/src/telemetry/trace/TraceContext'

export interface TransactionRequestInfo {
  txRequests: providers.TransactionRequest[] | undefined
  permitData?: TradingApi.NullablePermit
  gasFeeResult: GasFeeResult
  gasEstimate: SwapGasFeeEstimation
  swapRequestArgs: TradingApi.CreateSwapRequest | undefined
  includesDelegation?: boolean
}

export function processWrapResponse({
  gasFeeResult,
  wrapTxRequest,
  fallbackGasParams,
}: {
  gasFeeResult: GasFeeResult
  wrapTxRequest: providers.TransactionRequest | undefined
  fallbackGasParams?: providers.TransactionRequest
}): TransactionRequestInfo {
  const gasParams = gasFeeResult.params ?? fallbackGasParams ?? {}

  const wrapTxRequestWithGasFee = { ...wrapTxRequest, ...gasParams }

  const gasEstimate: SwapGasFeeEstimation = {
    wrapEstimate: gasFeeResult.gasEstimate,
  }

  return {
    gasFeeResult,
    txRequests: [wrapTxRequestWithGasFee],
    gasEstimate,
    swapRequestArgs: undefined,
  }
}

export function createPrepareSwapRequestParams({ gasStrategy }: { gasStrategy: GasStrategy }) {
  return function prepareSwapRequestParams({
    swapQuoteResponse,
    signature,
    transactionSettings,
    alreadyApproved,
    overrideSimulation,
  }: {
    swapQuoteResponse: ClassicQuoteResponse | BridgeQuoteResponse | WrapQuoteResponse | UnwrapQuoteResponse
    signature: string | undefined
    transactionSettings: TransactionSettings
    alreadyApproved: boolean
    overrideSimulation?: boolean
  }): TradingApi.CreateSwapRequest {
    const isBridgeTrade = swapQuoteResponse.routing === TradingApi.Routing.BRIDGE
    const permitData = swapQuoteResponse.permitData

    /**
     * Simulate transactions to ensure they will not fail on-chain.
     * Do not simulate for bridge transactions or txs that need an approval
     * as those require Tenderly to simulate and it is not currently integrated into the gas service
     *
     * If overrideSimulation is true (such as when using 7702 endpoint), that takes precedence.
     */
    const shouldSimulateTxn = overrideSimulation ?? (isBridgeTrade ? false : alreadyApproved)

    const deadline = getTradeSettingsDeadline(transactionSettings.customDeadline)

    return {
      quote: swapQuoteResponse.quote,
      permitData: permitData ?? undefined,
      signature,
      simulateTransaction: shouldSimulateTxn,
      deadline,
      refreshGasPrice: true,
      gasStrategies: [gasStrategy],
      urgency: SWAP_GAS_URGENCY_OVERRIDE,
    }
  }
}

export function getSwapInputExceedsBalance({ derivedSwapInfo }: { derivedSwapInfo: DerivedSwapInfo }): boolean {
  const { currencyBalances, currencyAmounts } = derivedSwapInfo
  const currencyAmount = currencyAmounts[CurrencyField.INPUT]
  const currencyBalance = currencyBalances[CurrencyField.INPUT]

  return Boolean(currencyBalance && currencyAmount && currencyBalance.lessThan(currencyAmount))
}

export function getShouldSkipSwapRequest({
  derivedSwapInfo,
  tokenApprovalInfo,
  signature,
  permitsDontNeedSignature,
}: {
  derivedSwapInfo: DerivedSwapInfo
  tokenApprovalInfo: TokenApprovalInfo | undefined
  signature: string | undefined
  permitsDontNeedSignature?: boolean
}): boolean {
  const { trade } = derivedSwapInfo.trade

  const requiresPermit2Sig = !!trade?.quote.permitData
  const missingSig = requiresPermit2Sig && !signature && !permitsDontNeedSignature
  const approvalInfoMissing = !tokenApprovalInfo?.action || tokenApprovalInfo.action === ApprovalAction.Unknown

  return getSwapInputExceedsBalance({ derivedSwapInfo }) || approvalInfoMissing || missingSig
}

/** Returns an error if simulation fails on backend and we expect the swap transaction to fail */
export function getSimulationError({
  swapQuote,
  isRevokeNeeded,
}: {
  swapQuote: TradingApi.ClassicQuote | TradingApi.BridgeQuote | undefined
  isRevokeNeeded: boolean
}): Error | null {
  if (!swapQuote || !('txFailureReasons' in swapQuote)) {
    return null
  }

  const validSimulationErrors = swapQuote.txFailureReasons?.filter((reason) => {
    const isExpectedErrorFromRevoke = isRevokeNeeded && reason === TradingApi.TransactionFailureReason.SIMULATION_ERROR
    return !isExpectedErrorFromRevoke
  })

  // TODO(SWAP-415): review why we're only returning some errors and ignoring the rest.

  if (validSimulationErrors?.includes(TradingApi.TransactionFailureReason.SLIPPAGE_TOO_LOW)) {
    return new SlippageTooLowError()
  }

  if (validSimulationErrors?.includes(TradingApi.TransactionFailureReason.SIMULATION_ERROR)) {
    return new UnknownSimulationError()
  }

  return null
}

export function createProcessSwapResponse({ gasStrategy }: { gasStrategy: GasStrategy }) {
  return function processSwapResponse({
    response,
    error,
    swapQuote,
    isSwapLoading,
    permitData,
    swapRequestParams,
    isRevokeNeeded,
    permitsDontNeedSignature,
  }: {
    response: SwapData | undefined
    error: Error | null
    swapQuote: TradingApi.ClassicQuote | TradingApi.BridgeQuote | undefined
    isSwapLoading: boolean
    permitData: TradingApi.NullablePermit | undefined
    swapRequestParams: TradingApi.CreateSwapRequest | undefined
    isRevokeNeeded: boolean
    permitsDontNeedSignature?: boolean
  }): TransactionRequestInfo {
    // We use the gasFee estimate from quote, as its more accurate
    const swapGasFee = {
      value: swapQuote?.gasFee,
      displayValue: convertGasFeeToDisplayValue(swapQuote?.gasFee, gasStrategy),
    }

    // This is a case where simulation fails on backend, meaning txn is expected to fail
    const simulationError = getSimulationError({ swapQuote, isRevokeNeeded })

    const gasEstimateError = simulationError ?? error

    const gasFeeResult = {
      value: swapGasFee.value,
      displayValue: swapGasFee.displayValue,
      isLoading: isSwapLoading,
      error: gasEstimateError,
    }

    const gasEstimate: SwapGasFeeEstimation = {
      swapEstimate: response?.gasEstimate,
    }

    return {
      gasFeeResult,
      txRequests: response?.transactions,
      permitData: permitsDontNeedSignature ? undefined : permitData,
      gasEstimate,
      includesDelegation: response?.includesDelegation,
      swapRequestArgs: swapRequestParams,
    }
  }
}

export function createLogSwapRequestErrors({ trace }: { trace: ITraceContext }) {
  return function logSwapRequestErrors({
    txRequest,
    gasFeeResult,
    derivedSwapInfo,
    transactionSettings,
    previousRequestId,
  }: {
    txRequest: providers.TransactionRequest | undefined
    gasFeeResult: GasFeeResult
    derivedSwapInfo: DerivedSwapInfo
    transactionSettings: TransactionSettings
    previousRequestId: string | undefined
  }): void {
    const quote = derivedSwapInfo.trade.trade?.quote
    const isNewQuote = quote?.requestId !== previousRequestId

    // Only log errors if we have a new valid quote
    if (!quote || !isNewQuote) {
      return
    }

    const quoteId = 'quoteId' in quote.quote ? quote.quote.quoteId : undefined

    // TODO(SWAP-415): review how we're logging these errors to avoid spamming the logs with things we don't need to log.
    if (gasFeeResult.error) {
      const extra = {
        ...getBaseTradeAnalyticsPropertiesFromSwapInfo({ derivedSwapInfo, transactionSettings, trace }),
        // we explicitly log it here to show on Datadog dashboard
        chainLabel: getChainLabel(derivedSwapInfo.chainId),
        requestId: quote.requestId,
        quoteId,
        error: gasFeeResult.error,
        simulationFailureReasons: isClassic(quote) ? quote.quote.txFailureReasons : undefined,
        txRequest,
      }

      if (gasFeeResult.error instanceof UnknownSimulationError || gasFeeResult.error instanceof SlippageTooLowError) {
        logger.warn('utils', 'logSwapRequestErrors', gasFeeResult.error.message, extra)
      } else {
        const gasFeeResultError = new Error('Failed to get gas estimate')
        gasFeeResultError.cause = gasFeeResult.error

        logger.error(gasFeeResultError, {
          tags: {
            file: 'swapTxAndGasInfoService/utils.ts',
            function: 'logSwapRequestErrors',
          },
          extra: {
            errorMessage: gasFeeResult.error.message,
            ...extra,
          },
        })
      }

      if (!(isMobileApp || isExtensionApp)) {
        sendAnalyticsEvent(SwapEventName.SwapEstimateGasCallFailed, {
          ...getBaseTradeAnalyticsPropertiesFromSwapInfo({ derivedSwapInfo, transactionSettings, trace }),
          error: gasFeeResult.error,
          txRequest,
          simulationFailureReasons: isClassic(quote) ? quote.quote.txFailureReasons : undefined,
        })
      }
    }
  }
}

export function createGasFields({
  swapTxInfo,
  approvalTxInfo,
  permitTxInfo = EMPTY_PERMIT_TX_INFO,
}: {
  swapTxInfo: TransactionRequestInfo
  approvalTxInfo: ApprovalTxInfo
  permitTxInfo?: {
    gasFeeResult: GasFeeResult
    gasEstimate?: GasEstimate
  }
}): Pick<BaseSwapTxAndGasInfo, 'gasFee' | 'gasFeeEstimation'> {
  const { approvalGasFeeResult, revokeGasFeeResult } = approvalTxInfo
  // Gas fees for: swap from quote response directly, wrap from Gas Fee API, approvals from checkApprovalQuery
  const gasFee = mergeGasFeeResults(
    swapTxInfo.gasFeeResult,
    approvalGasFeeResult,
    revokeGasFeeResult,
    permitTxInfo.gasFeeResult,
  )

  const gasFeeEstimation: SwapGasFeeEstimation = {
    ...swapTxInfo.gasEstimate,
    approvalEstimate: approvalGasFeeResult.gasEstimate,
  }

  return {
    gasFee,
    gasFeeEstimation,
  }
}

export function createApprovalFields({
  approvalTxInfo,
}: {
  approvalTxInfo: ApprovalTxInfo
}): Pick<BaseSwapTxAndGasInfo, 'approveTxRequest' | 'revocationTxRequest'> {
  const { tokenApprovalInfo } = approvalTxInfo
  const approveTxRequest = validateTransactionRequest(tokenApprovalInfo.txRequest)
  const revocationTxRequest = validateTransactionRequest(tokenApprovalInfo.cancelTxRequest)

  // Debug logging for approval fields (dev-only, Base Sepolia)
  if (process.env.NODE_ENV !== 'production') {
    const chainId = (tokenApprovalInfo.txRequest as any)?.chainId
    if (chainId === 84532) {
      const txTo = tokenApprovalInfo.txRequest?.to ? String(tokenApprovalInfo.txRequest.to).toLowerCase() : undefined
      const dataLen = (tokenApprovalInfo.txRequest?.data as string | undefined)?.length ?? 0
      logger.debugDeduped(
        'createApprovalFields',
        'createApprovalFields',
        'Approval fields created',
        {
          chainId,
          approvalAction: tokenApprovalInfo.action,
          hasTokenApprovalTxRequest: !!tokenApprovalInfo.txRequest,
          txTo,
          dataLen,
          hasValidatedApproveTxRequest: !!approveTxRequest,
          hasRevocationTxRequest: !!revocationTxRequest,
        },
        {
          ttlMs: 3000,
          minIntervalMs: 1500,
          maxPerWindow: 2,
          windowMs: 5000,
          includeKeys: ['chainId', 'approvalAction', 'hasTokenApprovalTxRequest', 'txTo', 'dataLen'],
        }
      )
    }
  }

  return {
    approveTxRequest,
    revocationTxRequest,
  }
}

export function getClassicSwapTxAndGasInfo({
  trade,
  swapTxInfo,
  approvalTxInfo,
  permitTxInfo,
}: {
  trade: ClassicTrade
  swapTxInfo: TransactionRequestInfo
  approvalTxInfo: ApprovalTxInfo
  permitTxInfo: PermitTxInfo
  includesDelegation?: boolean
}): ClassicSwapTxAndGasInfo {
  const txRequests = validateTransactionRequests(swapTxInfo.txRequests)
  const unsigned = Boolean(isWebApp && swapTxInfo.permitData)
  const typedData = validatePermit(swapTxInfo.permitData)

  const permit = typedData
    ? ({ method: PermitMethod.TypedData, typedData } as const)
    : permitTxInfo.permitTxRequest
      ? ({ method: PermitMethod.Transaction, txRequest: permitTxInfo.permitTxRequest } as const)
      : undefined

  const approvalFields = createApprovalFields({ approvalTxInfo })

  // CRITICAL: Verify spender address matches swap tx request (for on-chain-only swaps)
  // This ensures the approval is for the correct router/spender
  if (process.env.NODE_ENV !== 'production' && approvalFields.approveTxRequest && txRequests?.[0]) {
    const swapTxTo = txRequests[0].to
    const approvalTxTo = approvalFields.approveTxRequest.to

    // Extract spender from approval calldata (first 4 bytes are function selector, next 32 bytes are spender)
    const approvalData = approvalFields.approveTxRequest.data as string | undefined
    if (approvalData && approvalData.length >= 138) {
      // approve(address,uint256) selector: 0x095ea7b3
      // Spender is at offset 36-75 (32 bytes, padded)
      const spenderFromCalldata = `0x${approvalData.slice(34, 74)}`

      if (spenderFromCalldata.toLowerCase() !== swapTxTo?.toLowerCase()) {
        logger.warn('getClassicSwapTxAndGasInfo', 'getClassicSwapTxAndGasInfo', 'Spender mismatch detected', {
          chainId: trade.inputAmount.currency.chainId,
          approvalSpender: spenderFromCalldata,
          swapTxTo,
          approvalTxTo,
          note: 'Approval spender should match swap tx to address',
        })
      } else {
        const chainId = trade.inputAmount.currency.chainId
        const spender = spenderFromCalldata.toLowerCase()
        const swapTxToLower = swapTxTo?.toLowerCase()
        logger.debugDeduped(
          'getClassicSwapTxAndGasInfo',
          'getClassicSwapTxAndGasInfo',
          'Spender verification passed',
          {
            chainId,
            spender,
            swapTxTo: swapTxToLower,
          },
          {
            ttlMs: 3000,
            minIntervalMs: 1500,
            maxPerWindow: 2,
            windowMs: 5000,
            includeKeys: ['chainId', 'spender', 'swapTxTo'],
          }
        )
      }
    }
  }

  return {
    routing: trade.routing,
    trade,
    ...createGasFields({ swapTxInfo, approvalTxInfo, permitTxInfo }),
    ...approvalFields,
    swapRequestArgs: swapTxInfo.swapRequestArgs,
    unsigned,
    txRequests,
    permit,
    includesDelegation: swapTxInfo.includesDelegation,
  }
}

type PermitTxInfo = {
  permitTxRequest: ValidatedTransactionRequest | undefined
  gasFeeResult: GasFeeResult
  gasEstimate?: GasEstimate
}

export const EMPTY_PERMIT_TX_INFO: PermitTxInfo = {
  permitTxRequest: undefined,
  gasFeeResult: {
    value: '0',
    displayValue: '0',
    isLoading: false,
    error: null,
  },
}

// CRITICAL: All hooks must be called unconditionally. Early returns must happen AFTER all hooks.
export function usePermitTxInfo({
  quote,
}: {
  quote?: DiscriminatedQuoteResponse | SolanaTrade['quote']
}): PermitTxInfo {
  // Hook probe: before useActiveGasStrategy
  // CRITICAL: useRef must be called unconditionally at the very top, before any conditional logic
  const hookProbePermitH01 = useRef(0)
  hookProbePermitH01.current += 1 // Always increment, even in production (no-op if not logged)
  if (process.env.NODE_ENV !== 'production') {
    // Use deduped logging for HookProbe
    // Extract chainId from quote if it's a classic quote, otherwise undefined
    const chainId = quote && isClassic(quote) ? (quote as ClassicQuoteResponse).quote.chainId : undefined
    logger.debugDeduped(
      'usePermitTxInfo',
      'usePermitTxInfo',
      '[HookProbe] PERMIT-H01: before useActiveGasStrategy',
      {
        chainId,
        hasQuote: !!quote,
        isClassic: quote ? isClassic(quote) : false,
      },
      {
        ttlMs: 15000,
        minIntervalMs: 3000,
        keyParts: ['PERMIT-H01', chainId, !!quote],
      }
    )
  }

  // CRITICAL: Call ALL hooks unconditionally, regardless of quote state
  // When useOnChainQuote flips, quote might become undefined, but hooks must still be called
  const classicQuote = quote && isClassic(quote) ? quote : undefined
  // CRITICAL: useActiveGasStrategy must be called unconditionally
  // Pass undefined chainId if classicQuote is missing, but still call the hook
  const gasStrategy = useActiveGasStrategy(classicQuote?.quote.chainId, 'swap')

  // Hook probe: after useActiveGasStrategy
  // CRITICAL: useRef must be called unconditionally
  const hookProbePermitH02 = useRef(0)
  hookProbePermitH02.current += 1 // Always increment, even in production (no-op if not logged)
  if (process.env.NODE_ENV !== 'production') {
    // Use deduped logging for HookProbe
    // Extract chainId from classicQuote if available, otherwise from quote
    const chainId = classicQuote?.quote.chainId ?? (quote && isClassic(quote) ? (quote as ClassicQuoteResponse).quote.chainId : undefined)
    logger.debugDeduped(
      'usePermitTxInfo',
      'usePermitTxInfo',
      '[HookProbe] PERMIT-H02: after useActiveGasStrategy',
      {
        chainId,
        hasClassicQuote: !!classicQuote,
      },
      {
        ttlMs: 15000,
        minIntervalMs: 3000,
        keyParts: ['PERMIT-H02', chainId, !!classicQuote],
      }
    )
  }

  // CRITICAL: Early return check happens AFTER all hooks
  // If no classicQuote, return empty permit info (but hooks were already called)
  if (!classicQuote) {
    return EMPTY_PERMIT_TX_INFO
  }

  const getPermitTxInfo = createGetPermitTxInfo({ gasStrategy })
  return getPermitTxInfo({ quote: classicQuote })
}

export function createGetPermitTxInfo({ gasStrategy }: { gasStrategy: GasStrategy }) {
  return function getPermitTxInfo({ quote }: { quote: ClassicQuoteResponse }): PermitTxInfo {
    const permitTxRequest = validateTransactionRequest(quote.permitTransaction)

    if (!permitTxRequest) {
      return EMPTY_PERMIT_TX_INFO
    }

    return {
      permitTxRequest,
      gasFeeResult: {
        value: quote.permitGasFee,
        displayValue: convertGasFeeToDisplayValue(quote.permitGasFee, gasStrategy),
        isLoading: false,
        error: null,
      },
    }
  }
}

export function getBridgeSwapTxAndGasInfo({
  trade,
  swapTxInfo,
  approvalTxInfo,
}: {
  trade: BridgeTrade
  swapTxInfo: TransactionRequestInfo
  approvalTxInfo: ApprovalTxInfo
}): BridgeSwapTxAndGasInfo {
  const txRequests = validateTransactionRequests(swapTxInfo.txRequests)

  return {
    routing: trade.routing,
    trade,
    ...createGasFields({ swapTxInfo, approvalTxInfo }),
    ...createApprovalFields({ approvalTxInfo }),
    txRequests,
    includesDelegation: swapTxInfo.includesDelegation,
  }
}

export function getWrapTxAndGasInfo({
  trade,
  swapTxInfo,
}: {
  trade: WrapTrade | UnwrapTrade
  swapTxInfo: TransactionRequestInfo
}): ClassicSwapTxAndGasInfo | WrapSwapTxAndGasInfo {
  const txRequests = validateTransactionRequests(swapTxInfo.txRequests)

  return {
    routing: trade.routing,
    trade,
    txRequests,
    approveTxRequest: undefined,
    revocationTxRequest: undefined,
    gasFee: swapTxInfo.gasFeeResult,
    gasFeeEstimation: swapTxInfo.gasEstimate,
    includesDelegation: swapTxInfo.includesDelegation,
  }
}

export function getFallbackSwapTxAndGasInfo({
  trade,
  swapTxInfo,
  approvalTxInfo,
}: {
  trade?: ClassicTrade | null
  swapTxInfo: TransactionRequestInfo
  approvalTxInfo: ApprovalTxInfo
}): ClassicSwapTxAndGasInfo {
  const txRequests = validateTransactionRequests(swapTxInfo.txRequests)

  return {
    routing: TradingApi.Routing.CLASSIC,
    trade: trade ?? undefined,
    ...createGasFields({ swapTxInfo, approvalTxInfo }),
    ...createApprovalFields({ approvalTxInfo }),
    txRequests,
    permit: undefined,
    swapRequestArgs: swapTxInfo.swapRequestArgs,
    unsigned: false,
    includesDelegation: swapTxInfo.includesDelegation,
  }
}
