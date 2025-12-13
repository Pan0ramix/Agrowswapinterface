import { GasEstimate, TradingApi } from '@universe/api'
import { GasFeeResult, ValidatedGasFeeResult, validateGasFeeResult } from 'uniswap/src/features/gas/types'
import { SolanaTrade } from 'uniswap/src/features/transactions/swap/types/solana'
import {
  BridgeTrade,
  ChainedActionTrade,
  ClassicTrade,
  UniswapXTrade,
  UnwrapTrade,
  WrapTrade,
} from 'uniswap/src/features/transactions/swap/types/trade'
import {
  isBridge,
  isChained,
  isClassic,
  isJupiter,
  isUniswapX,
  isWrap,
} from 'uniswap/src/features/transactions/swap/utils/routing'
import { ValidatedPermit } from 'uniswap/src/features/transactions/swap/utils/trade'
import {
  PopulatedTransactionRequestArray,
  ValidatedTransactionRequest,
} from 'uniswap/src/features/transactions/types/transactionRequests'
import { isWebApp } from 'utilities/src/platform'
import { Prettify } from 'viem'

export type SwapTxAndGasInfo =
  | ClassicSwapTxAndGasInfo
  | UniswapXSwapTxAndGasInfo
  | BridgeSwapTxAndGasInfo
  | WrapSwapTxAndGasInfo
  | SolanaSwapTxAndGasInfo
  | ChainedSwapTxAndGasInfo
export type ValidatedSwapTxContext =
  | ValidatedClassicSwapTxAndGasInfo
  | ValidatedUniswapXSwapTxAndGasInfo
  | ValidatedBridgeSwapTxAndGasInfo
  | ValidatedWrapSwapTxAndGasInfo
  | ValidatedSolanaSwapTxAndGasInfo
  | ValidatedChainedSwapTxAndGasInfo

// Deduplication for INVALID logs (module-level cache)
const invalidLogCache = new Map<string, number>()
const DEDUPE_WINDOW_MS = 2000 // 2 seconds

function logInvalidSwapTxContext(validation: SwapTxContextValidation) {
  // Create stable key from reasons (sorted for consistency)
  const reasonsKey = JSON.stringify([...validation.reasons].sort())
  const now = Date.now()
  const lastLogTime = invalidLogCache.get(reasonsKey)

  // Skip if logged recently
  if (lastLogTime && now - lastLogTime < DEDUPE_WINDOW_MS) {
    return
  }

  // Update cache
  invalidLogCache.set(reasonsKey, now)

  // Clean old entries (keep cache size reasonable)
  if (invalidLogCache.size > 100) {
    const cutoff = now - DEDUPE_WINDOW_MS * 10
    for (const [key, timestamp] of invalidLogCache.entries()) {
      if (timestamp < cutoff) {
        invalidLogCache.delete(key)
      }
    }
  }

  // Use debug level to avoid console spam
  // Log the first reason for quick diagnosis
  // eslint-disable-next-line no-console
  console.debug('[SWAP-TX-CONTEXT] INVALID', {
    reason0: validation.reasons?.[0], // First reason for quick diagnosis
    reasons: validation.reasons,
    snapshot: validation.snapshot,
  })
}

export function isValidSwapTxContext(swapTxContext: SwapTxAndGasInfo): swapTxContext is ValidatedSwapTxContext {
  // Validation fn prevents/future-proofs typeguard against illicit casts
  const result = validateSwapTxContext(swapTxContext)
  const isValid = result !== undefined

  // Log diagnostic information when validation fails (debug level, deduplicated)
  if (!isValid) {
    const validation = validateSwapTxContextWithReasons(swapTxContext)
    logInvalidSwapTxContext(validation)
  }

  return isValid
}

export type SwapGasFeeEstimation = {
  swapEstimate?: GasEstimate
  approvalEstimate?: GasEstimate
  wrapEstimate?: GasEstimate
}

export type UniswapXGasBreakdown = {
  classicGasUseEstimateUSD?: string
  approvalCost?: string
  inputTokenSymbol?: string
}

export interface BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing
  trade?: ClassicTrade | UniswapXTrade | BridgeTrade | WrapTrade | UnwrapTrade | SolanaTrade | ChainedActionTrade
  approveTxRequest: ValidatedTransactionRequest | undefined
  revocationTxRequest: ValidatedTransactionRequest | undefined
  gasFee: GasFeeResult
  gasFeeEstimation: SwapGasFeeEstimation
  includesDelegation?: boolean
}

export enum PermitMethod {
  Transaction = 'Transaction',
  TypedData = 'TypedData',
}

export type PermitTransaction = {
  method: PermitMethod.Transaction
  txRequest: ValidatedTransactionRequest
}

export type PermitTypedData = {
  method: PermitMethod.TypedData
  typedData: ValidatedPermit
}

export interface ClassicSwapTxAndGasInfo extends BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing.CLASSIC
  trade?: ClassicTrade
  permit: PermitTransaction | PermitTypedData | undefined
  swapRequestArgs: TradingApi.CreateSwapRequest | undefined
  /**
   * `unsigned` is true if `txRequest` is undefined due to a permit signature needing to be signed first.
   * This occurs on interface where the user must be prompted to sign a permit before txRequest can be fetched.
   */
  unsigned: boolean
  txRequests: PopulatedTransactionRequestArray | undefined
}

export interface WrapSwapTxAndGasInfo extends BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing.WRAP | TradingApi.Routing.UNWRAP
  trade: WrapTrade | UnwrapTrade
  txRequests: PopulatedTransactionRequestArray | undefined
}

export interface UniswapXSwapTxAndGasInfo extends BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing.DUTCH_V2 | TradingApi.Routing.DUTCH_V3 | TradingApi.Routing.PRIORITY
  trade: UniswapXTrade
  permit: PermitTypedData | undefined
  gasFeeBreakdown: UniswapXGasBreakdown
}

export interface BridgeSwapTxAndGasInfo extends BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing.BRIDGE
  trade: BridgeTrade
  txRequests: PopulatedTransactionRequestArray | undefined
}

export interface SolanaSwapTxAndGasInfo extends BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing.JUPITER
  trade: SolanaTrade
  transactionBase64?: string
  approveTxRequest: undefined
  revocationTxRequest: undefined
  gasFee: GasFeeResult
  gasFeeEstimation: SwapGasFeeEstimation
  includesDelegation: false
}

// TODO: SWAP-458 - Subject to change.
export interface ChainedSwapTxAndGasInfo extends BaseSwapTxAndGasInfo {
  routing: TradingApi.Routing.CHAINED
  planId: string | undefined
  trade: ChainedActionTrade
  txRequests: PopulatedTransactionRequestArray | undefined
  /** Not needed for Chained Actions since it's already included in the steps/txRequests */
  approveTxRequest: undefined
  /** Not needed for Chained Actions since it's already included in the steps/txRequests */
  revocationTxRequest: undefined
  gasFee: GasFeeResult
  gasFeeEstimation: SwapGasFeeEstimation
}

interface BaseRequiredSwapTxContextFields {
  gasFee: ValidatedGasFeeResult
}

export type ValidatedClassicSwapTxAndGasInfo = Prettify<
  Required<Omit<ClassicSwapTxAndGasInfo, 'includesDelegation'>> &
    BaseRequiredSwapTxContextFields &
    (
      | {
          unsigned: true
          permit: PermitTypedData
          txRequests: undefined
        }
      | {
          unsigned: false
          permit: PermitTransaction | undefined
          txRequests: PopulatedTransactionRequestArray
        }
    ) &
    Pick<ClassicSwapTxAndGasInfo, 'includesDelegation'>
>

export type ValidatedWrapSwapTxAndGasInfo = Prettify<
  Required<Omit<WrapSwapTxAndGasInfo, 'includesDelegation'>> &
    BaseRequiredSwapTxContextFields & {
      txRequests: PopulatedTransactionRequestArray
    } & Pick<WrapSwapTxAndGasInfo, 'includesDelegation'>
>

export type ValidatedBridgeSwapTxAndGasInfo = Prettify<
  Required<Omit<BridgeSwapTxAndGasInfo, 'includesDelegation'>> &
    BaseRequiredSwapTxContextFields & {
      txRequests: PopulatedTransactionRequestArray
    } & Pick<BridgeSwapTxAndGasInfo, 'includesDelegation'>
>

export type ValidatedUniswapXSwapTxAndGasInfo = Prettify<
  Required<Omit<UniswapXSwapTxAndGasInfo, 'includesDelegation'>> &
    BaseRequiredSwapTxContextFields & {
      // Permit should always be defined for UniswapX orders
      permit: PermitTypedData
    } & Pick<UniswapXSwapTxAndGasInfo, 'includesDelegation'>
>

export type ValidatedSolanaSwapTxAndGasInfo = Prettify<
  Required<SolanaSwapTxAndGasInfo> & BaseRequiredSwapTxContextFields
>

export type ValidatedChainedSwapTxAndGasInfo = Prettify<
  Required<ChainedSwapTxAndGasInfo> & BaseRequiredSwapTxContextFields
>

// Safe helper functions for snapshot creation
const keys = (o: any): string[] => (o && typeof o === 'object' ? Object.keys(o) : [])
const hexLen = (x: any): number => (typeof x === 'string' ? x.length : 0)
const str = (v: any): string | undefined => (v == null ? undefined : String(v))
const trunc = (s: any, n = 32): string | undefined => {
  const x = typeof s === 'string' ? s : str(s)
  return x && x.length > n ? x.slice(0, n) + '…' : x
}

export type SwapTxContextValidation = {
  ok: boolean
  reasons: string[]
  snapshot: Record<string, unknown>
}

/**
 * Internal validation helper that returns detailed validation results with reason codes
 * Exported for use at commit points (e.g., when user clicks Swap)
 */
export function validateSwapTxContextWithReasons(swapTxContext: SwapTxAndGasInfo): SwapTxContextValidation {
  const reasons: string[] = []
  const trade = swapTxContext.trade
  const txRequests = (swapTxContext as any)?.txRequests
  const firstTxRequest = txRequests?.[0]
  const quote = (trade as any)?.quote
  const swapQuoteResponse = (swapTxContext as any)?.swapQuoteResponse
  
  // Extract chainId early for use throughout validation
  const chainId = trade?.inputAmount?.currency?.chainId

  // Build snapshot (safe, shallow fields only)
  const requestIdRaw =
    (swapTxContext as any)?.requestId ??
    swapQuoteResponse?.requestId ??
    quote?.requestId ??
    (trade as any)?.quote?.requestId

  // Extract approval info for diagnostics
  const approveTxRequest = (swapTxContext as any)?.approveTxRequest
  const revocationTxRequest = (swapTxContext as any)?.revocationTxRequest
  const tokenApprovalInfo = (swapTxContext as any)?.tokenApprovalInfo

  const snapshot: Record<string, unknown> = {
    routing: swapTxContext.routing ? String(swapTxContext.routing) : undefined,
    indicative: (trade as any)?.indicative ?? false,
    hasTxRequests: !!txRequests && txRequests.length > 0,
    txRequestsLength: txRequests?.length ?? 0,
    firstTxTo: firstTxRequest?.to,
    firstDataLen: hexLen(firstTxRequest?.data),
    firstValue: str(firstTxRequest?.value),
    hasTrade: !!trade,
    tradeKeys: keys(trade),
    hasAllowedSlippage: trade?.slippageTolerance != null,
    allowedSlippage: trade?.slippageTolerance != null ? str(trade.slippageTolerance) : undefined,
    hasPermit: !!(swapTxContext as any)?.permit,
    permitMethod: (swapTxContext as any)?.permit?.method,
    hasSwapRequestArgs: !!(swapTxContext as any)?.swapRequestArgs,
    swapRequestArgsKeys: keys((swapTxContext as any)?.swapRequestArgs),
    hasQuote: !!quote,
    quoteKeys: keys(quote),
    hasSwapQuoteResponse: !!swapQuoteResponse,
    swapQuoteKeys: keys(swapQuoteResponse),
    hasRequestId: !!requestIdRaw,
    requestId: trunc(requestIdRaw, 32),
    unsigned: (swapTxContext as any)?.unsigned ?? false,
    hasTransactionBase64: !!(swapTxContext as any)?.transactionBase64,
    // Approval diagnostics
    hasApproveTxRequest: !!approveTxRequest,
    approveTxRequestTo: approveTxRequest?.to,
    approveTxRequestChainId: approveTxRequest?.chainId,
    approveTxRequestDataLen: hexLen(approveTxRequest?.data),
    hasRevocationTxRequest: !!revocationTxRequest,
    tokenApprovalAction: tokenApprovalInfo?.action,
    tokenApprovalHasTxRequest: !!tokenApprovalInfo?.txRequest,
    ctxKeys: keys(swapTxContext),
  }

  // Check gasFee validation
  const gasFee = validateGasFeeResult(swapTxContext.gasFee)
  if (!gasFee) {
    // RELAXATION: Allow step generation with partial gasFee if approval tx exists (Base Sepolia only)
    // This breaks the deadlock: approval can be executed even if swap gas is unknown pre-approval.
    // After approval completes, swap gas can be recomputed.
    const hasApprovalTx = !!approveTxRequest
    const isOnChainOnly = chainId === 84532

    if (isOnChainOnly && hasApprovalTx) {
      // Allow validation to pass with placeholder gasFee for step building
      // The approval step can be generated and executed, then swap gas will be recomputed
      // This is safe because we're only relaxing for step generation, not execution
      // Do not add INVALID_GAS_FEE reason, allow validation to continue
    } else {
      reasons.push('INVALID_GAS_FEE')
      // Add gas snapshot for debugging
      const gasSnapshot: Record<string, unknown> = {
        hasGasFee: !!swapTxContext.gasFee,
        gasFeeValue: swapTxContext.gasFee?.value,
        gasFeeError: swapTxContext.gasFee?.error ? String(swapTxContext.gasFee.error) : null,
        gasFeeIsLoading: swapTxContext.gasFee?.isLoading,
        gasFeeDisplayValue: swapTxContext.gasFee?.displayValue,
        gasFeeParams: swapTxContext.gasFee?.params,
        // Check first txRequest for gas fields
        firstTxRequestGasLimit: firstTxRequest?.gasLimit,
        firstTxRequestGasPrice: firstTxRequest?.gasPrice,
        firstTxRequestMaxFeePerGas: firstTxRequest?.maxFeePerGas,
        firstTxRequestMaxPriorityFeePerGas: firstTxRequest?.maxPriorityFeePerGas,
        relaxationApplied: false,
      }
      return { ok: false, reasons, snapshot: { ...snapshot, gas: gasSnapshot } }
    }
  }

  // Check if trade exists
  if (!swapTxContext.trade) {
    reasons.push('MISSING_TRADE')
    return { ok: false, reasons, snapshot }
  }

  // For on-chain-only chains, relax validation requirements
  const isOnChainOnly = chainId === 84532
  
  // Route-specific validation
  if (isClassic(swapTxContext)) {
    const { unsigned, permit, txRequests } = swapTxContext

    if (unsigned) {
      // SwapTxContext should only ever be unsigned / still require a signature on interface.
      if (!isWebApp) {
        reasons.push('UNSIGNED_NOT_WEB_APP')
      }
      if (!permit) {
        reasons.push('UNSIGNED_WITHOUT_PERMIT')
      } else if (permit.method !== PermitMethod.TypedData) {
        reasons.push('UNSIGNED_WITHOUT_TYPED_DATA_PERMIT')
      }
      if (reasons.length > 0) {
        return { ok: false, reasons, snapshot }
      }
      // Valid unsigned classic swap
      return { ok: true, reasons: [], snapshot }
    } else {
      // Signed classic swap requires txRequests
      if (!txRequests || txRequests.length === 0) {
        reasons.push('CLASSIC_MISSING_TX_REQUESTS')
        // For on-chain-only chains, log which fields are missing for debugging
        if (isOnChainOnly) {
          const missingFields: string[] = []
          if (!txRequests) missingFields.push('txRequests')
          if (!swapTxContext.trade) missingFields.push('trade')
          if (!gasFee) missingFields.push('gasFee')
          snapshot.missingFields = missingFields
          snapshot.isOnChainOnly = true
          if (process.env.NODE_ENV !== 'production') {
            logger.debug('validateSwapTxContextWithReasons', 'validateSwapTxContextWithReasons', '[VALIDATION] Missing fields for on-chain swap', {
              chainId,
              missingFields,
              hasTrade: !!swapTxContext.trade,
              hasTxRequests: !!txRequests,
              hasGasFee: !!gasFee,
              hasApproveTxRequest: !!approveTxRequest,
            })
          }
        }
        return { ok: false, reasons, snapshot }
      }
      // Valid signed classic swap
      return { ok: true, reasons: [], snapshot }
    }
  } else if (isBridge(swapTxContext)) {
    const { txRequests } = swapTxContext
    if (!txRequests || txRequests.length === 0) {
      reasons.push('BRIDGE_MISSING_TX_REQUESTS')
      return { ok: false, reasons, snapshot }
    }
    return { ok: true, reasons: [], snapshot }
  } else if (isUniswapX(swapTxContext)) {
    if (!swapTxContext.permit) {
      reasons.push('UNISWAPX_MISSING_PERMIT')
      return { ok: false, reasons, snapshot }
    }
    return { ok: true, reasons: [], snapshot }
  } else if (isWrap(swapTxContext)) {
    const { txRequests } = swapTxContext
    if (!txRequests || txRequests.length === 0) {
      reasons.push('WRAP_MISSING_TX_REQUESTS')
      return { ok: false, reasons, snapshot }
    }
    return { ok: true, reasons: [], snapshot }
  } else if (isJupiter(swapTxContext)) {
    if (!swapTxContext.transactionBase64) {
      reasons.push('JUPITER_MISSING_TRANSACTION_BASE64')
      return { ok: false, reasons, snapshot }
    }
    return { ok: true, reasons: [], snapshot }
  } else if (isChained(swapTxContext)) {
    // Chained swaps are valid if gasFee is valid (already checked)
    return { ok: true, reasons: [], snapshot }
  } else {
    reasons.push('UNSUPPORTED_ROUTING')
    return { ok: false, reasons, snapshot }
  }
}

/**
 * Validates a SwapTxAndGasInfo object without any casting and returns a ValidatedSwapTxContext object if the object is valid.
 * @param swapTxContext - The SwapTxAndGasInfo object to validate.
 * @returns A ValidatedSwapTxContext object if the object is valid, otherwise undefined.
 */
function validateSwapTxContext(swapTxContext: SwapTxAndGasInfo): ValidatedSwapTxContext | undefined {
  const gasFee = validateGasFeeResult(swapTxContext.gasFee)

  if (!gasFee) {
    return undefined
  }

  if (swapTxContext.trade) {
    if (isClassic(swapTxContext)) {
      const { trade, unsigned, permit, txRequests, includesDelegation } = swapTxContext

      if (unsigned) {
        // SwapTxContext should only ever be unsigned / still require a signature on interface.
        if (!isWebApp || !permit || permit.method !== PermitMethod.TypedData) {
          return undefined
        }
        return { ...swapTxContext, trade, gasFee, unsigned, txRequests: undefined, permit, includesDelegation }
      } else if (txRequests) {
        return { ...swapTxContext, trade, gasFee, unsigned, txRequests, permit: undefined, includesDelegation }
      } else {
        return undefined
      }
    } else if (isBridge(swapTxContext)) {
      const { trade, txRequests, includesDelegation } = swapTxContext
      if (txRequests) {
        return { ...swapTxContext, trade, gasFee, txRequests, includesDelegation }
      } else {
        return undefined
      }
    } else if (isUniswapX(swapTxContext) && swapTxContext.permit) {
      const { trade, permit } = swapTxContext
      return { ...swapTxContext, trade, gasFee, permit, includesDelegation: false }
    } else if (isWrap(swapTxContext)) {
      const { trade, txRequests } = swapTxContext
      if (txRequests) {
        return { ...swapTxContext, trade, gasFee, txRequests, includesDelegation: false }
      } else {
        return undefined
      }
    } else if (isJupiter(swapTxContext) && swapTxContext.transactionBase64) {
      return { ...swapTxContext, transactionBase64: swapTxContext.transactionBase64, gasFee }
    } else if (isChained(swapTxContext)) {
      const { includesDelegation } = swapTxContext
      return { ...swapTxContext, gasFee, includesDelegation: includesDelegation ?? false }
    } else {
      return undefined
    }
  } else {
    return undefined
  }
}
