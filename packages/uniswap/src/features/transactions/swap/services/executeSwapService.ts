import type { PresetPercentage } from 'uniswap/src/components/CurrencyInputPanel/AmountInputPresets/types'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import type { SwapTxStoreState } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/createSwapTxStore'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { SwapCallbackParams } from 'uniswap/src/features/transactions/swap/types/swapCallback'
import type {
  ExecuteSwapCallback,
  PrepareSwapCallback,
} from 'uniswap/src/features/transactions/swap/types/swapHandlers'
import type { SwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { isValidSwapTxContext } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { isClassic } from 'uniswap/src/features/transactions/swap/utils/routing'
import { AccountDetails, isSignerMnemonicAccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { CurrencyField } from 'uniswap/src/types/currency'
import { summarizeGasFee, summarizeTxRequest, swapDebug, swapError } from 'uniswap/src/utils/swapDebug'

type ExecuteSwap = () => Promise<void> | void

export interface ExecuteSwapService {
  executeSwap: ExecuteSwap
}

export type GetExecuteSwapService = (ctx: {
  onSuccess: () => void
  onFailure: () => void
  onPending: () => void
  setCurrentStep: SwapCallbackParams['setCurrentStep']
  setSteps: SwapCallbackParams['setSteps']
  getSwapTxContext: () => SwapTxAndGasInfo
}) => ExecuteSwapService

export function createExecuteSwapService(ctx: {
  getAccount?: () => AccountDetails | undefined
  getSwapTxContext?: () => SwapTxStoreState
  getDerivedSwapInfo: () => DerivedSwapInfo
  getTxSettings: () => { customSlippageTolerance?: number }
  getIsFiatMode?: () => boolean
  getPresetInfo: () => { presetPercentage: PresetPercentage | undefined; preselectAsset: boolean | undefined }
  onSuccess: () => void
  onFailure: (error?: Error) => void
  onPending: () => void
  setCurrentStep: SwapCallbackParams['setCurrentStep']
  setSteps: SwapCallbackParams['setSteps']
  onPrepareSwap: PrepareSwapCallback
  onExecuteSwap: ExecuteSwapCallback
}): { executeSwap: ExecuteSwap } {
  // Unified execution pattern - handles both swaps and wraps through SwapHandlers
  return {
    executeSwap: (): Promise<void> | void => {
      const derivedSwapInfo = ctx.getDerivedSwapInfo()
      const { currencyAmounts, currencyAmountsUSDValue, txId, wrapType, chainId } = derivedSwapInfo
      const { customSlippageTolerance } = ctx.getTxSettings()
      const swapTxContext = ctx.getSwapTxContext?.()
      const account = ctx.getAccount?.()

      // Get connector info for logging
      const connector = (account as any)?.connector

      // Check for on-chain-only fast path
      const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
      const hasOnChainOnlyTx =
        isOnChainOnly && swapTxContext && isClassic(swapTxContext) && !!(swapTxContext as any).txRequests?.length

      const validSwapTxContext = swapTxContext ? isValidSwapTxContext(swapTxContext) : false

      // Comprehensive entry log
      const txRequests = (swapTxContext as any)?.txRequests
      const firstTxRequest = txRequests?.[0]
      const approveTxRequest = (swapTxContext as any)?.approveTxRequest

      // Boundary log B: Saga entry (Base Sepolia only) - MUST print
      if (chainId === 84532) {
        swapError(chainId, '[BOUNDARY-B][EXECUTE-SWAP] enter', {
          chainId,
          routing: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
          hasTxRequests: !!txRequests && txRequests.length > 0,
          txRequestsLength: txRequests?.length ?? 0,
          hasApprove: !!approveTxRequest,
          validSwapTxContext,
        })
      }

      swapDebug(chainId, '[EXECUTE-SWAP] ENTER', {
        isOnChainOnly,
        accountAddress: account?.address,
        connectorName: connector?.name,
        swapTxContextRouting: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
        txRequestsLength: txRequests?.length ?? 0,
        firstTxRequestSummary: summarizeTxRequest(firstTxRequest),
        gasFeeSummary: summarizeGasFee(swapTxContext?.gasFee),
        validSwapTxContext,
        hasOnChainOnlyTx,
      })

      // Log before early return for debugging
      if (!account) {
        swapDebug(chainId, '[EXECUTE-SWAP] EARLY_RETURN', {
          reason: 'NO_ACCOUNT',
          accountAddress: account?.address,
          connectorName: connector?.name,
          hasTxRequests: isClassic(swapTxContext) ? Boolean(swapTxContext.txRequests?.length) : false,
          isValidSwapTxContext: validSwapTxContext,
          hasOnChainOnlyTx,
        })
        ctx.onFailure(new Error('No account available'))
        return
      }

      if (!swapTxContext) {
        swapDebug(chainId, '[EXECUTE-SWAP] EARLY_RETURN', {
          reason: 'NO_SWAP_TX_CONTEXT',
          accountAddress: account.address,
          connectorName: connector?.name,
          hasTxRequests: false,
          isValidSwapTxContext: false,
          hasOnChainOnlyTx: false,
        })
        ctx.onFailure(new Error('Missing swap transaction context'))
        return
      }

      if (!isSignerMnemonicAccountDetails(account)) {
        swapDebug(chainId, '[EXECUTE-SWAP] EARLY_RETURN', {
          reason: 'INVALID_ACCOUNT_TYPE',
          accountAddress: account.address,
          connectorName: connector?.name,
          hasTxRequests: isClassic(swapTxContext) ? Boolean(swapTxContext.txRequests?.length) : false,
          isValidSwapTxContext: validSwapTxContext,
          hasOnChainOnlyTx,
        })
        ctx.onFailure(new Error('Invalid account type - must be signer mnemonic account'))
        return
      }

      if (!validSwapTxContext && !hasOnChainOnlyTx) {
        swapDebug(chainId, '[EXECUTE-SWAP] EARLY_RETURN', {
          reason: 'INVALID_SWAP_TX_CONTEXT',
          accountAddress: account.address,
          connectorName: connector?.name,
          hasTxRequests: isClassic(swapTxContext) ? Boolean(swapTxContext.txRequests?.length) : false,
          isValidSwapTxContext: validSwapTxContext,
          hasOnChainOnlyTx,
          gasFeeSummary: summarizeGasFee(swapTxContext.gasFee),
        })
        ctx.onFailure(new Error('Invalid swap transaction context'))
        return
      }

      // Log before submitting (reuse txRequests and firstTxRequest from above)
      swapDebug(chainId, '[EXECUTE-SWAP] SUBMITTING', {
        firstTxRequestSummary: summarizeTxRequest(firstTxRequest),
        swapTxContextRouting: swapTxContext.routing ? String(swapTxContext.routing) : undefined,
      })

      const { presetPercentage, preselectAsset } = ctx.getPresetInfo()

      const executeParams = {
        account,
        swapTxContext,
        currencyInAmountUSD: currencyAmountsUSDValue[CurrencyField.INPUT] ?? undefined,
        currencyOutAmountUSD: currencyAmountsUSDValue[CurrencyField.OUTPUT] ?? undefined,
        isAutoSlippage: !customSlippageTolerance,
        presetPercentage,
        preselectAsset,
        onSuccess: ctx.onSuccess,
        onFailure: ctx.onFailure,
        onPending: ctx.onPending,
        txId,
        setCurrentStep: ctx.setCurrentStep,
        setSteps: ctx.setSteps,
        isFiatInputMode: ctx.getIsFiatMode?.(),
        wrapType,
        inputCurrencyAmount: currencyAmounts.input ?? undefined,
      }

      // Reuse txRequests and firstTxRequest from earlier declaration
      swapDebug(chainId, '[EXECUTE-SWAP] dispatching-action', {
        accountAddress: account.address,
        connectorName: connector?.name,
        txRequestSummary: summarizeTxRequest(firstTxRequest),
        routing: swapTxContext.routing ? String(swapTxContext.routing) : undefined,
        hasOnExecuteSwap: typeof ctx.onExecuteSwap === 'function',
      })

      try {
        const result = ctx.onExecuteSwap(executeParams)
        const isPromise = result && typeof result === 'object' && typeof result.then === 'function'

        swapDebug(chainId, '[EXECUTE-SWAP] dispatch-returned', {
          returnValueType: isPromise ? 'promise' : result === undefined ? 'undefined' : typeof result,
          isPromise,
        })

        if (isPromise) {
          // Attach logging to promise and propagate rejection (don't swallow)
          return result.then(
            (value) => {
              swapDebug(chainId, '[EXECUTE-SWAP] dispatch-promise-resolved', {
                resolvedValueType: value === undefined ? 'undefined' : typeof value,
              })
              return value
            },
            (error) => {
              // Log the real error with full context including action type and IDs
              swapError(chainId, '[EXECUTE-SWAP] dispatch-promise-rejected', {
                error,
                accountAddress: account.address,
                connectorName: connector?.name,
                routing: swapTxContext.routing ? String(swapTxContext.routing) : undefined,
                txRequestSummary: summarizeTxRequest(firstTxRequest),
                txId,
                actionType: 'onExecuteSwap',
              })
              // Re-throw to propagate to caller's catch block
              throw error
            },
          )
        } else {
          // If it's not a promise, return it as-is (synchronous result)
          return result
        }
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error))
        const shortStack = errorObj.stack?.split('\n').slice(0, 3).join('\n')

        swapError(chainId, '[EXECUTE-SWAP] SUBMIT threw', {
          error: errorObj,
          accountAddress: account.address,
          connectorName: connector?.name,
          txId,
          routing: swapTxContext.routing ? String(swapTxContext.routing) : undefined,
        })

        // Rethrow after logging so caller can handle it
        throw error
      } finally {
        swapDebug(chainId, '[EXECUTE-SWAP] SUBMIT finally', {
          accountAddress: account.address,
        })
      }
    },
  }
}
