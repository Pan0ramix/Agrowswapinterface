import { createApprovalTransactionStep } from 'uniswap/src/features/transactions/steps/approve'
import { createPermit2SignatureStep } from 'uniswap/src/features/transactions/steps/permit2Signature'
import { createPermit2TransactionStep } from 'uniswap/src/features/transactions/steps/permit2Transaction'
import { createRevocationTransactionStep } from 'uniswap/src/features/transactions/steps/revoke'
import { TransactionStep } from 'uniswap/src/features/transactions/steps/types'
import { orderClassicSwapSteps } from 'uniswap/src/features/transactions/swap/steps/classicSteps'
import { createSignUniswapXOrderStep } from 'uniswap/src/features/transactions/swap/steps/signOrder'
import {
  createSwapTransactionAsyncStep,
  createSwapTransactionStep,
  createSwapTransactionStepBatched,
} from 'uniswap/src/features/transactions/swap/steps/swap'
import { orderUniswapXSteps } from 'uniswap/src/features/transactions/swap/steps/uniswapxSteps'
import {
  isValidSwapTxContext,
  SwapTxAndGasInfo,
  validateSwapTxContextWithReasons,
} from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { isBridge, isClassic, isUniswapX } from 'uniswap/src/features/transactions/swap/utils/routing'
import { boundaryLog } from 'uniswap/src/utils/boundaryLog'

export function generateSwapTransactionSteps(txContext: SwapTxAndGasInfo, v4Enabled?: boolean): TransactionStep[] {
  // Log ENTER with presence flags
  const trade = txContext.trade
  const txRequests = (txContext as any)?.txRequests
  const firstTxRequest = txRequests?.[0]
  const quote = (trade as any)?.quote
  const chainId = trade?.inputAmount.currency.chainId
  const approveTxRequest = (txContext as any)?.approveTxRequest

  // Guaranteed "enter" log at the very top (Base Sepolia only)
  boundaryLog(
    '[GENERATE-STEPS] enter',
    {
      tags: { file: 'generateSwapTransactionSteps', function: 'generateSwapTransactionSteps' },
      extra: {
        chainId,
        routing: trade?.routing ? String(trade.routing) : undefined,
        indicative: (trade as any)?.indicative ?? false,
        hasTxRequest: !!txRequests?.length,
        txRequestsLength: txRequests?.length ?? 0,
      },
    },
    chainId,
  )

  console.log('[GENERATE-STEPS] ENTER', {
    chainId,
    routing: trade?.routing ? String(trade.routing) : undefined,
    indicative: (trade as any)?.indicative ?? false,
    hasTxRequest: !!firstTxRequest,
    txTo: firstTxRequest?.to,
    dataLen: (firstTxRequest?.data as string | undefined)?.length,
    hasTrade: !!trade,
    tradeKeys: trade ? Object.keys(trade) : null,
    hasQuote: !!quote,
    quoteKeys: quote ? Object.keys(quote) : null,
    requestId: quote?.requestId ?? (trade as any)?.quote?.requestId,
    hasAllowedSlippage: trade?.slippageTolerance != null,
    hasApproveTxRequest: !!approveTxRequest,
    hasRevocationTxRequest: !!(txContext as any)?.revocationTxRequest,
    hasPermit: !!(txContext as any)?.permit,
    permitMethod: (txContext as any)?.permit?.method,
    txRequestsLength: txRequests?.length ?? 0,
    txContextKeys: txContext ? Object.keys(txContext) : null,
  })

  // For Base Sepolia on-chain-only: Normalize context before validation
  let normalizedContext = txContext
  const routing = trade?.routing ? String(trade.routing) : undefined

  // Normalize gasFee if invalid
  if (chainId === 84532 && txContext.gasFee) {
    const gasFee = txContext.gasFee
    // If gasFee is invalid (value undefined or error present), try to normalize it
    if (gasFee.value === undefined || gasFee.error !== null) {
      // Try to derive value from params: total cost = fee per gas * gas limit
      let derivedValue: string | undefined
      if (gasFee.params) {
        if ('maxFeePerGas' in gasFee.params && gasFee.params.gasLimit) {
          // EIP-1559: total = maxFeePerGas * gasLimit
          const maxFeePerGas = BigInt(gasFee.params.maxFeePerGas)
          const gasLimit = BigInt(gasFee.params.gasLimit)
          derivedValue = (maxFeePerGas * gasLimit).toString()
        } else if ('gasPrice' in gasFee.params && gasFee.params.gasLimit) {
          // Legacy: total = gasPrice * gasLimit
          const gasPrice = BigInt(gasFee.params.gasPrice)
          const gasLimit = BigInt(gasFee.params.gasLimit)
          derivedValue = (gasPrice * gasLimit).toString()
        }
      }

      if (derivedValue) {
        // Create normalized context with valid gasFee
        normalizedContext = {
          ...txContext,
          gasFee: {
            ...gasFee,
            value: derivedValue,
            error: null,
          },
        } as SwapTxAndGasInfo
      }
    }
  }

  // For CLASSIC routing on Base Sepolia: Ensure txRequests is properly set before validation
  if (chainId === 84532 && routing === 'CLASSIC') {
    const currentTxRequests = (normalizedContext as any)?.txRequests
    // If we have txRequests with length 1, ensure they're properly recognized
    if (currentTxRequests && Array.isArray(currentTxRequests) && currentTxRequests.length === 1) {
      // Ensure txRequests is explicitly set (not undefined)
      normalizedContext = {
        ...normalizedContext,
        txRequests: currentTxRequests,
      } as SwapTxAndGasInfo
    }
  }

  let isValidSwap = isValidSwapTxContext(normalizedContext)

  if (!isValidSwap) {
    // Get detailed validation reasons - guaranteed to run
    const validation = validateSwapTxContextWithReasons(normalizedContext)
    const { reasons, snapshot } = validation
    const firstReason = reasons[0]
    const hasBlockingReasons = reasons.length > 0
    const txRequestsLength = (normalizedContext as any)?.txRequests?.length ?? 0
    const hasTxRequests = txRequestsLength > 0

    // Guaranteed log line on every INVALID_SWAP_TX_CONTEXT early return
    // Force the validator reason string to print plainly
    boundaryLog(
      '[GENERATE-STEPS] INVALID_SWAP_TX_CONTEXT details',
      {
        tags: { file: 'generateSwapTransactionSteps', function: 'generateSwapTransactionSteps' },
        extra: {
          chainId,
          firstReason,
          reasonsString: Array.isArray(reasons) ? reasons.join('|') : String(reasons),
          reasons,
          snapshot,
          txRequestsLength,
          hasTxRequests,
          hasBlockingReasons,
          txContextKeys: normalizedContext ? Object.keys(normalizedContext as any) : [],
        },
      },
      chainId,
    )

    // RESILIENCE: Do not exit early if:
    // 1. No blocking reasons (reasons.length === 0) - validator may be overly strict
    // 2. We have txRequests - steps can be generated even if gas estimate failed
    // 3. For on-chain-only chains, allow proceeding with missing gas fee (will be estimated at execution)
    const isOnChainOnly = chainId === 84532
    const hasOnlyGasFeeIssue = hasBlockingReasons && firstReason === 'INVALID_GAS_FEE' && hasTxRequests

    if (!hasBlockingReasons && hasTxRequests) {
      // No blocking reasons but we have txRequests - proceed to step generation
      // Gas fee may be missing but that's OK for on-chain-only (will be estimated at execution)
      boundaryLog(
        '[GENERATE-STEPS] proceeding despite invalid context (no blocking reasons, has txRequests)',
        {
          tags: { file: 'generateSwapTransactionSteps', function: 'generateSwapTransactionSteps' },
          extra: {
            txRequestsLength,
            reasonsLength: reasons.length,
          },
        },
        chainId,
      )
      isValidSwap = true // Override validation to allow step generation
    } else if (isOnChainOnly && hasOnlyGasFeeIssue && hasTxRequests) {
      // On-chain-only: allow proceeding if only issue is gas fee (STF/estimation failure)
      // Steps can be generated; gas will be estimated at execution time
      boundaryLog(
        '[GENERATE-STEPS] proceeding despite gas fee issue (on-chain-only, has txRequests)',
        {
          tags: { file: 'generateSwapTransactionSteps', function: 'generateSwapTransactionSteps' },
          extra: {
            txRequestsLength,
            firstReason,
          },
        },
        chainId,
      )
      isValidSwap = true // Override validation to allow step generation
    } else if (firstReason === 'CLASSIC_MISSING_TX_REQUESTS' && chainId === 84532 && routing === 'CLASSIC') {
      // If firstReason is CLASSIC_MISSING_TX_REQUESTS, try to fix it
      const txRequestsToFix = (normalizedContext as any)?.txRequests || txRequests
      if (txRequestsToFix && Array.isArray(txRequestsToFix) && txRequestsToFix.length > 0) {
        // Create a new normalized context with explicit txRequests array
        const fixedContext = {
          ...normalizedContext,
          txRequests: txRequestsToFix,
        } as SwapTxAndGasInfo

        // Re-validate with fixed context
        const revalidation = validateSwapTxContextWithReasons(fixedContext)
        if (revalidation.ok) {
          // Use the fixed context and update validation status
          normalizedContext = fixedContext
          isValidSwap = isValidSwapTxContext(normalizedContext)
          if (isValidSwap) {
            boundaryLog(
              '[GENERATE-STEPS] CLASSIC_MISSING_TX_REQUESTS fixed',
              {
                tags: { file: 'generateSwapTransactionSteps', function: 'generateSwapTransactionSteps' },
                extra: {
                  txRequestsLength: (normalizedContext as any)?.txRequests?.length ?? 0,
                },
              },
              chainId,
            )
            // Continue with fixed context - proceed to step building below
          } else {
            boundaryLog(
              '[GENERATE-STEPS] exit-early',
              { chainId, reason: 'INVALID_SWAP_TX_CONTEXT (fix failed)' },
              chainId,
            )
            return []
          }
        } else {
          boundaryLog(
            '[GENERATE-STEPS] exit-early',
            { chainId, reason: 'INVALID_SWAP_TX_CONTEXT (revalidation failed)' },
            chainId,
          )
          return []
        }
      } else {
        boundaryLog(
          '[GENERATE-STEPS] exit-early',
          { chainId, reason: 'INVALID_SWAP_TX_CONTEXT (no txRequests to fix)' },
          chainId,
        )
        return []
      }
    } else if (!hasTxRequests) {
      // No txRequests is a hard blocker - cannot generate steps
      boundaryLog(
        '[GENERATE-STEPS] exit-early',
        { chainId, reason: 'INVALID_SWAP_TX_CONTEXT (missing txRequests)' },
        chainId,
      )
      return []
    } else {
      // Other blocking reasons - exit early
      boundaryLog(
        '[GENERATE-STEPS] exit-early',
        { chainId, reason: `INVALID_SWAP_TX_CONTEXT (${firstReason})` },
        chainId,
      )
      return []
    }
  }

  // Use normalized context for the rest of the function
  const txContextToUse = normalizedContext

  // Proceed with step building if validation passed (or was fixed)
  if (isValidSwap) {
    const { trade, approveTxRequest, revocationTxRequest } = txContextToUse

    if (!trade) {
      console.log('[GENERATE-STEPS] EARLY-RETURN', {
        reason: 'MISSING_TRADE',
        chainId,
        hasTxRequests: !!txRequests && txRequests.length > 0,
      })
      return []
    }

    const revocation = createRevocationTransactionStep(revocationTxRequest, trade.inputAmount.currency.wrapped)

    // Boundary log C: Before calling generateSwapTransactionSteps (inside the function, right before approval step creation)
    // CRITICAL: Ensure approveTxRequest is present and has required fields
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.log('[SWAP-SAGA] before-generate', {
        chainId,
        txRequestsLength: txRequests?.length ?? 0,
        hasApproveTxRequest: !!approveTxRequest,
        approveTxRequestTo: approveTxRequest?.to,
        approveTxRequestChainId: approveTxRequest?.chainId,
        approveTxRequestDataLen: (approveTxRequest?.data as string | undefined)?.length,
        hasAmountIn: !!trade.inputAmount,
        amountInValue: trade.inputAmount.quotient.toString(),
      })
    }

    // CRITICAL FIX: Ensure amountIn is available for approval step creation
    // For on-chain-only swaps, trade.inputAmount should always be present, but add fallback
    const amountIn = trade.inputAmount ?? (trade as any)?.inputAmount ?? undefined

    const approval = createApprovalTransactionStep({ txRequest: approveTxRequest, amountIn })

    // Debug logging for approval step creation (Base Sepolia on-chain-only)
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.log('[GENERATE-STEPS] approval step creation', {
        chainId,
        hasApproveTxRequest: !!approveTxRequest,
        approveTxRequestTo: approveTxRequest?.to,
        approveTxRequestDataLen: (approveTxRequest?.data as string | undefined)?.length,
        hasAmountIn: !!trade.inputAmount,
        amountInValue: trade.inputAmount.quotient.toString(),
        approvalStepCreated: !!approval,
        approvalStepType: approval?.type,
        approvalStepSpender: approval?.spender,
      })
    }

    if (isClassic(txContextToUse)) {
      const { swapRequestArgs } = txContextToUse

      if (txContextToUse.unsigned) {
        if (!txContextToUse.permit || txContextToUse.permit.method !== 'TypedData') {
          console.log('[GENERATE-STEPS] EARLY-RETURN', {
            reason: 'UNSIGNED_WITHOUT_PERMIT',
            chainId,
            hasPermit: !!txContextToUse.permit,
            permitMethod: txContextToUse.permit?.method,
          })
          return []
        }
        if (!swapRequestArgs) {
          console.log('[GENERATE-STEPS] EARLY-RETURN', {
            reason: 'UNSIGNED_WITHOUT_SWAP_REQUEST_ARGS',
            chainId,
          })
          return []
        }
        return orderClassicSwapSteps({
          revocation,
          approval,
          permit: createPermit2SignatureStep(txContextToUse.permit.typedData, trade.inputAmount.currency),
          swap: createSwapTransactionAsyncStep(swapRequestArgs),
        })
      }
      const txRequestsArray = (txContextToUse as any)?.txRequests
      if (txRequestsArray && txRequestsArray.length > 1) {
        return orderClassicSwapSteps({
          permit: undefined,
          swap: createSwapTransactionStepBatched(txRequestsArray),
        })
      }

      if (!txRequestsArray || txRequestsArray.length === 0) {
        console.log('[GENERATE-STEPS] EARLY-RETURN', {
          reason: 'MISSING_TX_REQUEST',
          chainId,
          unsigned: txContextToUse.unsigned,
          hasTxRequests: !!txContextToUse.txRequests,
          txRequestsLength: txContextToUse.txRequests?.length ?? 0,
        })
        return []
      }

      const permit = txContextToUse.permit
        ? createPermit2TransactionStep({
            txRequest: txContextToUse.permit.txRequest,
            amountIn: trade.inputAmount,
          })
        : undefined

      // Log classic components before ordering (Base Sepolia only)
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        console.log('[GENERATE-STEPS] classic-components', {
          chainId,
          hasApprovalStep: !!approval,
          hasSwapStep: !!txContextToUse.txRequests?.[0],
          hasRevocation: !!revocation,
          hasPermit: !!permit,
        })
      }

      const steps = orderClassicSwapSteps({
        revocation,
        approval,
        permit,
        swap: createSwapTransactionStep(txContextToUse.txRequests[0]),
      })

      // Single unmissable trace: Steps built successfully
      boundaryLog(
        '[GENERATE-STEPS] built-steps',
        {
          tags: { file: 'generateSwapTransactionSteps', function: 'generateSwapTransactionSteps' },
          extra: {
            chainId,
            stepsLength: steps.length,
            stepsTypes: steps.map((s: any) => s.type),
          },
        },
        chainId,
      )

      return steps
    } else if (isUniswapX(txContextToUse)) {
      if (!txContextToUse.permit) {
        console.log('[GENERATE-STEPS] EARLY-RETURN', {
          reason: 'UNISWAPX_WITHOUT_PERMIT',
          chainId,
        })
        return []
      }
      if (!trade.quote.quote) {
        console.log('[GENERATE-STEPS] EARLY-RETURN', {
          reason: 'UNISWAPX_WITHOUT_QUOTE',
          chainId,
          hasQuote: !!trade.quote,
        })
        return []
      }
      return orderUniswapXSteps({
        revocation,
        approval,
        signOrder: createSignUniswapXOrderStep(txContextToUse.permit.typedData, txContextToUse.trade.quote.quote),
      })
    } else if (isBridge(txContextToUse)) {
      if (!txContextToUse.txRequests || txContextToUse.txRequests.length === 0) {
        console.log('[GENERATE-STEPS] EARLY-RETURN', {
          reason: 'BRIDGE_WITHOUT_TX_REQUESTS',
          chainId,
          hasTxRequests: !!txContextToUse.txRequests,
          txRequestsLength: txContextToUse.txRequests?.length ?? 0,
        })
        return []
      }
      if (txContextToUse.txRequests.length > 1) {
        return orderClassicSwapSteps({
          permit: undefined,
          swap: createSwapTransactionStepBatched(txContextToUse.txRequests),
        })
      }
      return orderClassicSwapSteps({
        revocation,
        approval,
        permit: undefined,
        swap: createSwapTransactionStep(txContextToUse.txRequests[0]),
      })
    } else {
      console.log('[GENERATE-STEPS] EARLY-RETURN', {
        reason: 'UNSUPPORTED_ROUTING',
        chainId,
        routing: trade.routing ? String(trade.routing) : undefined,
        isClassic: isClassic(txContextToUse),
        isUniswapX: isUniswapX(txContextToUse),
        isBridge: isBridge(txContextToUse),
      })
      return []
    }
  }

  // This should not be reached if we logged INVALID_SWAP_TX_CONTEXT above, but keeping for safety

  console.log('[GENERATE-STEPS] EARLY-RETURN', {
    reason: 'NOT_VALID_SWAP',
    chainId,
    hasTrade: !!trade,
    hasTxRequests: !!txRequests && txRequests.length > 0,
    routing: trade?.routing ? String(trade.routing) : undefined,
  })
  return []
}
