import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { useCallback, useMemo } from 'react'
import { useSwapCallback } from 'state/sagas/transactions/swapSaga'
import { useWrapCallback } from 'state/sagas/transactions/wrapSaga'
import {
  ExecuteSwapCallback,
  ExecuteSwapParams,
  PrepareSwapCallback,
  SwapHandlers,
} from 'uniswap/src/features/transactions/swap/types/swapHandlers'
import { isWrap } from 'uniswap/src/features/transactions/swap/utils/routing'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { swapDebug } from 'uniswap/src/utils/swapDebug'

/**
 * Validates that all required parameters for a wrap transaction are present.
 * @throws {Error} If inputCurrencyAmount or wrapType is missing
 * @returns Validated wrap parameters
 */
export function validateWrapParams(params: ExecuteSwapParams): {
  inputCurrencyAmount: CurrencyAmount<Currency>
  wrapType: WrapType.Wrap | WrapType.Unwrap
} {
  if (!params.inputCurrencyAmount || !params.wrapType) {
    throw new Error('Missing required wrap parameters')
  }
  return {
    inputCurrencyAmount: params.inputCurrencyAmount,
    wrapType: params.wrapType,
  }
}

/**
 * Web implementation of SwapHandlers that routes between swap and wrap callbacks.
 * This provides a unified interface without implementing pre-signing (web doesn't need it).
 */
export function useSwapHandlers(): SwapHandlers {
  const swapCallback = useSwapCallback()
  const wrapCallback = useWrapCallback()

  // Web doesn't pre-sign transactions, so this is a no-op
  const prepareAndSign: PrepareSwapCallback = useCallback(async () => {}, [])

  // Execute routes to the appropriate callback based on transaction type
  const execute: ExecuteSwapCallback = useCallback(
    async (params) => {
      const {
        account,
        swapTxContext,
        currencyInAmountUSD,
        currencyOutAmountUSD,
        isAutoSlippage,
        presetPercentage,
        preselectAsset,
        onSuccess,
        onFailure,
        onPending,
        txId,
        setCurrentStep,
        setSteps,
        isFiatInputMode,
      } = params

      const chainId =
        swapTxContext?.trade?.inputAmount?.currency.chainId ??
        swapTxContext?.trade?.outputAmount?.currency.chainId ??
        (swapTxContext?.txRequests?.[0]?.chainId as number | undefined)
      const txRequest = swapTxContext?.txRequests?.[0]
      const isOnChainOnly = isOnChainOnlyChain(chainId)

      const normalizedValue =
        typeof txRequest?.value === 'bigint'
          ? `0x${txRequest.value.toString(16)}`
          : txRequest?.value ?? '0x0'

      swapDebug(chainId, '[SWAP-HANDLERS] execute', {
        routing: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
        isOnChainOnly,
        hasTxRequest: !!txRequest,
        txTo: txRequest?.to,
        txDataLen: (txRequest?.data as string | undefined)?.length,
        txValue: normalizedValue,
        accountAddress: account?.address,
      })

      if (isOnChainOnly && !txRequest) {
        onFailure(new Error('On-chain swap missing tx request'))
        return
      }

      // Route to appropriate callback based on transaction type
      if (isWrap(swapTxContext)) {
        // Handle wrap transactions
        try {
          const { inputCurrencyAmount, wrapType } = validateWrapParams(params)
          const txRequest = swapTxContext.txRequests[0]

          wrapCallback({
            account,
            inputCurrencyAmount,
            txRequest,
            txId,
            wrapType,
            gasEstimate: swapTxContext.gasFeeEstimation.wrapEstimate,
            onSuccess,
            onFailure,
          })
        } catch (error) {
          onFailure(error instanceof Error ? error : new Error('Unknown validation error'))
          return
        }
      } else {
        // Handle regular swap transactions
        swapDebug(chainId, '[SWAP-HANDLERS] calling-swapCallback', {
          accountAddress: account?.address,
          routing: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
          hasTxRequest: !!txRequest,
        })

        swapCallback({
          account,
          swapTxContext,
          currencyInAmountUSD,
          currencyOutAmountUSD,
          isAutoSlippage,
          presetPercentage,
          preselectAsset,
          onSuccess,
          onFailure,
          onPending,
          txId,
          setCurrentStep,
          setSteps,
          isFiatInputMode,
          includesDelegation: swapTxContext.includesDelegation,
        })
      }
    },
    [swapCallback, wrapCallback],
  )

  return useMemo(
    () => ({
      prepareAndSign,
      execute,
    }),
    [prepareAndSign, execute],
  )
}
