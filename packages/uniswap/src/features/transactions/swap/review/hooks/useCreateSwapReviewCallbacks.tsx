import { TradingApi } from '@universe/api'
import { useCallback } from 'react'
// biome-ignore lint/style/noRestrictedImports: only using to keep a consistent timing on interface
import { ADAPTIVE_MODAL_ANIMATION_DURATION } from 'ui/src/components/modal/AdaptiveWebModal'
import type { ParsedWarnings } from 'uniswap/src/components/modals/WarningModal/types'
import type { AuthTrigger } from 'uniswap/src/features/auth/types'
import { TransactionScreen } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import type { TransactionStep } from 'uniswap/src/features/transactions/steps/types'
import { shouldShowFlashblocksUI } from 'uniswap/src/features/transactions/swap/components/UnichainInstantBalanceModal/utils'
import { useIsUnichainFlashblocksEnabled } from 'uniswap/src/features/transactions/swap/hooks/useIsUnichainFlashblocksEnabled'
import {
  ensureFreshSwapTxData,
  useSwapParams,
  useSwapTxAndGasInfoService,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/hooks'
import type { GetExecuteSwapService } from 'uniswap/src/features/transactions/swap/services/executeSwapService'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { useSwapDependenciesStore } from 'uniswap/src/features/transactions/swap/stores/swapDependenciesStore/useSwapDependenciesStore'
import { useSwapTxStore } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/useSwapTxStore'
import type { SwapFormState } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/types'
import type { SetCurrentStepFn } from 'uniswap/src/features/transactions/swap/types/swapCallback'
import { isClassic } from 'uniswap/src/features/transactions/swap/utils/routing'
import { createTransactionId } from 'uniswap/src/utils/createTransactionId'
import { tryCatch } from 'utilities/src/errors'
import { isWebApp } from 'utilities/src/platform'
import { useEvent } from 'utilities/src/react/hooks'
import {
  swapDebug,
  swapError,
  summarizeTxRequest,
  summarizeTrade,
} from 'uniswap/src/utils/swapDebug'
import { isValidSwapTxContext, validateSwapTxContextWithReasons } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { boundaryLog } from 'uniswap/src/utils/boundaryLog'

interface SwapReviewCallbacks {
  onSwapButtonClick: () => Promise<void>
  onConfirmWarning: () => void
  onCancelWarning: () => void
  onShowWarning: () => void
  onCloseWarning: () => void
}

export function useCreateSwapReviewCallbacks(ctx: {
  resetCurrentStep: () => void
  setScreen: (screen: TransactionScreen) => void
  authTrigger?: AuthTrigger
  onSubmitSwap?: () => Promise<void> | void
  setSubmissionError: (error?: Error) => void
  setRetrySwap: (onPressRetry?: () => void) => void
  onClose: () => void
  showWarningModal: boolean
  warningAcknowledged: boolean
  shouldSubmitTx: boolean
  setShowWarningModal: (show: boolean) => void
  setWarningAcknowledged: (acknowledged: boolean) => void
  setShouldSubmitTx: (shouldSubmit: boolean) => void
  getExecuteSwapService: GetExecuteSwapService
  updateSwapForm: (newState: Partial<SwapFormState>) => void
  reviewScreenWarning: ParsedWarnings['reviewScreenWarning']
  setCurrentStep: SetCurrentStepFn
  setSteps: (steps: TransactionStep[]) => void
}): SwapReviewCallbacks {
  const {
    resetCurrentStep,
    setScreen,
    authTrigger,
    onSubmitSwap,
    setSubmissionError,
    setRetrySwap,
    onClose,
    showWarningModal,
    warningAcknowledged,
    shouldSubmitTx,
    setShowWarningModal,
    setWarningAcknowledged,
    setShouldSubmitTx,
    getExecuteSwapService,
    updateSwapForm,
    reviewScreenWarning,
    setCurrentStep,
    setSteps,
  } = ctx

  const { derivedSwapInfo } = useSwapDependenciesStore((s) => ({
    derivedSwapInfo: s.derivedSwapInfo,
    getExecuteSwapService: s.getExecuteSwapService,
  }))
  const chainId = derivedSwapInfo.chainId
  const isFlashblocksEnabled = useIsUnichainFlashblocksEnabled(chainId)

  // Get account from wallet hook (same source as rest of app) to avoid stale closure
  const wallet = useWallet()
  const account = wallet.evmAccount ?? wallet.svmAccount ?? derivedSwapInfo.account

  const shouldShowConfirmedState =
    shouldShowFlashblocksUI(derivedSwapInfo.trade.trade?.routing) ||
    // show the confirmed state for bridges
    derivedSwapInfo.trade.trade?.routing === TradingApi.Routing.BRIDGE

  const onFailure = useCallback(
    (error?: Error, onPressRetry?: () => void) => {
      resetCurrentStep()

      // Create a new txId for the next transaction, as the existing one may be used in state to track the failed submission.
      const newTxId = createTransactionId()
      updateSwapForm({ isSubmitting: false, isConfirmed: false, txId: newTxId, showPendingUI: false })

      setSubmissionError(error)
      setRetrySwap(() => onPressRetry)
    },
    [updateSwapForm, setSubmissionError, resetCurrentStep, setRetrySwap],
  )

  const onSuccess = useCallback(() => {
    // For Unichain networks, trigger confirmation and branch to stall+fetch logic (ie handle in component)
    if (isFlashblocksEnabled && shouldShowConfirmedState) {
      resetCurrentStep()
      updateSwapForm({
        isConfirmed: true,
        isSubmitting: false,
        showPendingUI: false,
      })
      return
    }

    // On interface, the swap component stays mounted; after swap we reset the form to avoid showing the previous values.
    if (isWebApp) {
      updateSwapForm({
        exactAmountFiat: undefined,
        exactAmountToken: '',
        showPendingUI: false,
        isConfirmed: false,
        instantReceiptFetchTime: undefined,
        instantOutputAmountRaw: undefined,
        txHash: undefined,
        txHashReceivedTime: undefined,
      })
      setTimeout(
        () =>
          updateSwapForm({
            isSubmitting: false,
          }),
        ADAPTIVE_MODAL_ANIMATION_DURATION,
      )
      setScreen(TransactionScreen.Form)
    }
    onClose()
  }, [setScreen, updateSwapForm, onClose, isFlashblocksEnabled, shouldShowConfirmedState, resetCurrentStep])

  const onPending = useCallback(() => {
    // Skip pending UI only for Unichain networks with flashblocks-compatible routes
    if (isFlashblocksEnabled && shouldShowConfirmedState) {
      return
    }
    updateSwapForm({ showPendingUI: true })
  }, [updateSwapForm, isFlashblocksEnabled, shouldShowConfirmedState])

  const swapTxAndGasInfoService = useSwapTxAndGasInfoService()
  const swapTxStoreState = useSwapTxStore((s) => s)

  const swapParams = useSwapParams()

  const executeSwap = useEvent(async () => {
    if (!swapParams.trade) {
      onFailure(new Error('No `trade` found when calling `executeSwap`'))
      return
    }

    const chainId = swapParams.derivedSwapInfo.chainId
    const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false

    // Fast path for on-chain-only chains: skip ensureFreshSwapTxData if txRequests already exist
    // This avoids calling the classic service that requires trade.quote.quote (which doesn't exist on-chain-only)
    const hasOnChainOnlyTx =
      isOnChainOnly &&
      isClassic(swapTxStoreState) &&
      !!swapTxStoreState.txRequests?.length

    let freshSwapTxData

    if (hasOnChainOnlyTx) {
      // Use existing swapTxStoreState directly for on-chain-only swaps
      swapDebug(chainId, '[SWAP-CTA] fast-path', {
        hasTxRequests: true,
        txRequestsLength: swapTxStoreState.txRequests?.length ?? 0,
        firstTxRequestSummary: summarizeTxRequest(swapTxStoreState.txRequests?.[0]),
      })
      freshSwapTxData = swapTxStoreState
    } else {
      swapDebug(chainId, '[SWAP-CTA] ensureFreshSwapTxData', {
        hasTrade: !!swapParams.trade,
      })
      // Ensure we have fresh transaction data before executing the swap.
      // We need this because we allow the user to click `Submit` when a new `/quote` response is being displayed in the UI
      // even though we might still not have the corresponding `/swap` response for that `/quote`.
      // We use the stale `/swap` response from the previous quote to avoid showing a loading state every time we poll/refetch a new `/quote`.
      const { data, error } = await tryCatch(
        // This should return immediately if the data is already cached and fresh.
        ensureFreshSwapTxData(
          {
            trade: swapParams.trade,
            approvalTxInfo: swapParams.approvalTxInfo,
            derivedSwapInfo: swapParams.derivedSwapInfo,
          },
          swapTxAndGasInfoService,
        ),
      )

      if (error) {
        const wrappedError = new Error('Failed to ensure fresh transaction data when calling `executeSwap`', {
          cause: error,
        })

        swapError(chainId, '[SWAP-CTA] ensureFreshSwapTxData failed', {
          errorMessage: wrappedError.message,
          errorName: wrappedError.name,
          cause: error instanceof Error ? error.message : String(error),
        })

        // If we fail to get fresh data, show error and don't proceed with swap
        onFailure(wrappedError)
        return
      }

      freshSwapTxData = data
    }

    const tx0 = freshSwapTxData?.txRequests?.[0]
    const storeTx0 = swapTxStoreState?.txRequests?.[0]
    const normalizedValue =
      typeof tx0?.value === 'bigint'
        ? `0x${tx0.value.toString(16)}`
        : tx0?.value ?? '0x0'

    const freshChainId = freshSwapTxData?.trade?.inputAmount?.currency.chainId

    swapDebug(freshChainId ?? chainId, '[SWAP-CTA] prepared-swap-tx-context', {
      routing: freshSwapTxData?.routing ? String(freshSwapTxData.routing) : undefined,
      hasTxRequest: Boolean(tx0),
      txTo: tx0?.to,
      txDataLen: (tx0?.data as string | undefined)?.length,
      txValue: normalizedValue,
      txGasLimit: tx0?.gasLimit,
      txMaxFeePerGas: tx0?.maxFeePerGas,
      txMaxPriorityFeePerGas: tx0?.maxPriorityFeePerGas,
      txGasPrice: tx0?.gasPrice,
      // Compare with store state
      storeHasTxRequest: Boolean(storeTx0),
      storeTxTo: storeTx0?.to,
      storeTxDataLen: (storeTx0?.data as string | undefined)?.length,
      storeTxValue: storeTx0?.value,
      storeRouting: swapTxStoreState?.routing ? String(swapTxStoreState.routing) : undefined,
    })

    const executeSwapService = getExecuteSwapService({
      onSuccess,
      onFailure,
      onPending,
      setCurrentStep,
      setSteps,
      getSwapTxContext: () => freshSwapTxData,
    })

    // Await the result to propagate errors to caller's catch block
    await executeSwapService.executeSwap()
  })

  const submitTransaction = useEvent(async () => {
    const chainId = swapParams.derivedSwapInfo.chainId

    if (reviewScreenWarning && !showWarningModal && !warningAcknowledged) {
      setShouldSubmitTx(true)
      setShowWarningModal(true)
      return
    }

    try {
      await executeSwap()
    } catch (error) {
      // Catch errors from executeSwap to prevent unhandled rejection
      const txId = swapParams.derivedSwapInfo.txId
      swapError(chainId, '[SWAP-CTA] submitTransaction failed', {
        error,
        hasReviewScreenWarning: !!reviewScreenWarning,
        txId,
      })
      // Ensure submitting state is reset
      updateSwapForm({ isSubmitting: false })
      // Re-throw so onSwapButtonClick can handle it
      throw error
    }
  })

  const onSwapButtonClick = useCallback(async () => {
    const chainId = swapParams.derivedSwapInfo.chainId
    const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
    
    // Boundary log A: UI click handler (Base Sepolia only) - MUST be first line
    if (chainId === 84532) {
      swapError(chainId, '[BOUNDARY-A][UI] swap-click', {
        chainId,
        isOnChainOnly,
        hasTrade: !!swapParams.trade,
        hasOnChainQuote: !!(swapParams.trade as any)?.quote,
        routing: swapParams.trade?.routing ? String(swapParams.trade.routing) : undefined,
      })
    }
    
    // Hard log at the very top to prove click handler is reached
    swapDebug(chainId, '[SWAP-CTA] onPress-enter', {
      disabled: false, // We're inside the handler, so it's not disabled
      hasOnPress: true,
      chainId,
    })

    updateSwapForm({ isSubmitting: true })
    const hasTxRequests = !!(swapTxStoreState as any).txRequests?.length
    const swapTxContext = swapTxStoreState

    // Use account from wallet hook (same source as rest of app) to avoid stale closure
    // Fallback to derivedSwapInfo.account if wallet hook doesn't have it
    const accountFromWallet = wallet.evmAccount ?? wallet.svmAccount
    const account = accountFromWallet ?? derivedSwapInfo.account
    const connector = (account as any)?.connector

    // Comprehensive click boundary log
    const txRequests = (swapTxContext as any)?.txRequests
    const firstTxRequest = txRequests?.[0]

    swapDebug(chainId, '[SWAP-CTA] clicked', {
      isOnChainOnly,
      accountAddress: account?.address,
      connectorName: connector?.name,
      hasTrade: Boolean(swapParams.trade),
      tradeSummary: summarizeTrade(swapParams.trade),
      hasSwapTxContext: Boolean(swapTxContext),
      swapTxContextRouting: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
      txRequestsLength: txRequests?.length ?? 0,
      firstTxRequestSummary: summarizeTxRequest(firstTxRequest),
    })

    // Check account first - don't treat missing account as "invalid context"
    const hasAccount = Boolean(account?.address)
    if (!hasAccount) {
      swapDebug(chainId, '[SWAP-CTA] account-missing', {
        accountAddress: account?.address,
        connectorName: connector?.name,
        accountFromWallet: accountFromWallet?.address,
        accountFromDerived: derivedSwapInfo.account?.address,
      })
      
      // Upstream behavior: should open connect wallet modal when account is missing
      // Note: Connect modal should be opened at the component level (not in this callback)
      // The button should be disabled or show "Connect Wallet" when no account
      // For now, we return early - the UI should handle showing connect prompt
      return
    }

    // Only validate swapTxContext if we have account and context is ready
    const readyToValidate = Boolean(chainId && account?.address && swapTxContext)
    if (readyToValidate && !isValidSwapTxContext(swapTxContext)) {
      const validation = validateSwapTxContextWithReasons(swapTxContext)
      swapError(chainId, '[SWAP-CTA] INVALID swapTxContext at commit point', {
        reasons: validation.reasons,
        snapshot: validation.snapshot,
        accountAddress: account?.address,
        connectorName: connector?.name,
      })
      // Continue anyway - let the saga handle the error, but we've logged the issue
    }

    try {
      boundaryLog(
        '[CONFIRM-UI] dispatch/execute start',
        {
          tags: { file: 'useCreateSwapReviewCallbacks', function: 'onSwapButtonClick' },
          extra: { chainId },
        },
        chainId
      )

      if (authTrigger) {
        await authTrigger({
          successCallback: submitTransaction,
          failureCallback: onFailure,
        })
      } else {
        await submitTransaction()
      }
      await onSubmitSwap?.()

      boundaryLog(
        '[CONFIRM-UI] dispatch/execute done',
        {
          tags: { file: 'useCreateSwapReviewCallbacks', function: 'onSwapButtonClick' },
          extra: { chainId },
        },
        chainId
      )
    } catch (error: any) {
      // Single unmissable trace: UI execution error
      boundaryLog(
        '[CONFIRM-UI] dispatch/execute threw',
        {
          tags: { file: 'useCreateSwapReviewCallbacks', function: 'onSwapButtonClick' },
          extra: {
            chainId,
            message: error?.message,
            name: error?.name,
            stack: error?.stack,
          },
        },
        chainId
      )

      // Top-level error handler - prevents unhandled promise rejection
      const txId = derivedSwapInfo.txId
      swapError(chainId, '[SWAP-CTA] click handler failed', {
        error,
        accountAddress: account?.address,
        connectorName: connector?.name,
        hasTxRequests,
        txRequestsLength: txRequests?.length ?? 0,
        txId,
        routing: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
      })
      // Ensure submitting state is reset
      updateSwapForm({ isSubmitting: false })
      // Call onFailure to handle the error in UI
      onFailure(error instanceof Error ? error : new Error(String(error)))
      throw error // Re-throw to ensure error is not silently absorbed
    }
  }, [authTrigger, onFailure, submitTransaction, updateSwapForm, onSubmitSwap, swapParams, swapTxStoreState, derivedSwapInfo, wallet, account])

  const onConfirmWarning = useCallback(async () => {
    setWarningAcknowledged(true)
    setShowWarningModal(false)

    if (shouldSubmitTx) {
      await executeSwap()
    }
  }, [shouldSubmitTx, executeSwap, setShowWarningModal, setWarningAcknowledged])

  const onCancelWarning = useCallback(() => {
    if (shouldSubmitTx) {
      onFailure()
    }

    setShowWarningModal(false)
    setWarningAcknowledged(false)
    setShouldSubmitTx(false)
  }, [onFailure, shouldSubmitTx, setShowWarningModal, setWarningAcknowledged, setShouldSubmitTx])

  const onShowWarning = useCallback(() => {
    setShowWarningModal(true)
  }, [setShowWarningModal])

  const onCloseWarning = useCallback(() => {
    setShowWarningModal(false)
  }, [setShowWarningModal])

  return {
    onSwapButtonClick,
    onConfirmWarning,
    onCancelWarning,
    onShowWarning,
    onCloseWarning,
  }
}
