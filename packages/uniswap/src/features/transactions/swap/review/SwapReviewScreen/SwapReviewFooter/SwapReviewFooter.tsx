import { memo, useMemo } from 'react'
import { Flex, IconButton, useIsShortMobileDevice } from 'ui/src'
import { BackArrow } from 'ui/src/components/icons/BackArrow'
import type { Warning } from 'uniswap/src/components/modals/WarningModal/types'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { TransactionModalFooterContainer } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModal'
import { useSwapOnPrevious } from 'uniswap/src/features/transactions/swap/review/hooks/useSwapOnPrevious'
import { SubmitSwapButton } from 'uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewFooter/SubmitSwapButton'
import { useSwapReviewCallbacksStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewCallbacksStore/useSwapReviewCallbacksStore'
import { useShowInterfaceReviewSteps } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewStore/useSwapReviewStore'
import { useSwapReviewTransactionStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewTransactionStore/useSwapReviewTransactionStore'
import { useSwapReviewWarningStore } from 'uniswap/src/features/transactions/swap/review/stores/swapReviewWarningStore/useSwapReviewWarningStore'
import { useSwapFormStore } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { isValidSwapTxContext } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { isChained, isClassic } from 'uniswap/src/features/transactions/swap/utils/routing'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { UnichainPoweredMessage } from 'uniswap/src/features/transactions/TransactionDetails/UnichainPoweredMessage'
import { getShouldDisplayTokenWarningCard } from 'uniswap/src/features/transactions/TransactionDetails/utils/getShouldDisplayTokenWarningCard'
import { isWebPlatform } from 'utilities/src/platform'
import {
  swapDebug,
  summarizeGasFee,
  summarizeTxRequest,
  summarizeTrade,
} from 'uniswap/src/utils/swapDebug'
import { useActiveAddress, useActiveWallet } from 'uniswap/src/features/accounts/store/hooks'
import { boundaryLogDeduped } from 'uniswap/src/utils/boundaryLog'

export const SwapReviewFooter = memo(function SwapReviewFooter(): JSX.Element | null {
  // Heartbeat log - must be at the top before any conditional returns
  const swapTxContext = useSwapReviewTransactionStore((s) => s.swapTxContext)
  const chainId = swapTxContext?.trade?.inputAmount?.currency?.chainId
  const accountAddress = useActiveAddress(chainId)
  const activeWallet = useActiveWallet(chainId)
  const connector = (activeWallet as any)?.connector

  // Heartbeat log - dedupe with long TTL to reduce spam
  boundaryLogDeduped(
    '[SWAP-REVIEW] heartbeat',
    {
      tags: { file: 'SwapReviewFooter', function: 'SwapReviewFooter' },
      extra: {
        chainId,
        hasChainId: chainId != null,
        accountAddress,
        connectorName: connector?.name,
      },
    },
    chainId,
    {
      ttlMs: 5000,
      includeKeys: ['chainId', 'accountAddress', 'connectorName'],
    }
  )

  const showInterfaceReviewSteps = useShowInterfaceReviewSteps()
  const { onPrev } = useSwapOnPrevious()
  const { disabled, showPendingUI, warning, onSubmit } = useSwapSubmitButton()
  const isShortMobileDevice = useIsShortMobileDevice()
  const showUnichainPoweredMessage = useSwapReviewTransactionStore((s) => {
    const isUnichain = s.chainId && [UniverseChainId.Unichain, UniverseChainId.UnichainSepolia].includes(s.chainId)
    if (!isUnichain) {
      return false
    }
    const routing = s.derivedSwapInfo.trade.trade?.routing
    return routing !== undefined && !isChained({ routing })
  })

  if (showInterfaceReviewSteps) {
    return null
  }

  return (
    <TransactionModalFooterContainer>
      {showUnichainPoweredMessage && <UnichainPoweredMessage />}
      <Flex row gap="$spacing8">
        {!isWebPlatform && !showPendingUI && (
          <IconButton
            icon={<BackArrow />}
            emphasis="secondary"
            size={isShortMobileDevice ? 'medium' : 'large'}
            onPress={onPrev}
          />
        )}
        <SubmitSwapButton disabled={disabled} showPendingUI={showPendingUI} warning={warning} onSubmit={onSubmit} />
      </Flex>
    </TransactionModalFooterContainer>
  )
})

function useSwapSubmitButton(): {
  disabled: boolean
  showPendingUI: boolean
  warning: Warning | undefined
  onSubmit: () => Promise<void>
} {
  const {
    tokenWarningProps,
    feeOnTransferProps,
    blockingWarning,
    newTradeRequiresAcceptance,
    reviewScreenWarning,
    swapTxContext,
    isWrap,
  } = useSwapReviewTransactionStore((s) => ({
    tokenWarningProps: s.tokenWarningProps,
    feeOnTransferProps: s.feeOnTransferProps,
    blockingWarning: s.blockingWarning,
    newTradeRequiresAcceptance: s.newTradeRequiresAcceptance,
    reviewScreenWarning: s.reviewScreenWarning,
    swapTxContext: s.swapTxContext,
    isWrap: s.isWrap,
  }))

  const tokenWarningChecked = useSwapReviewWarningStore((s) => s.tokenWarningChecked)
  const { isSubmitting, showPendingUI } = useSwapFormStore((s) => ({
    isSubmitting: s.isSubmitting,
    showPendingUI: s.showPendingUI,
  }))
  const onSwapButtonClick = useSwapReviewCallbacksStore((s) => s.onSwapButtonClick)
  const { shouldDisplayTokenWarningCard } = getShouldDisplayTokenWarningCard({
    tokenWarningProps,
    feeOnTransferProps,
  })

  // Get account info for logging (hooks must be outside useMemo)
  const chainId = swapTxContext?.trade?.inputAmount?.currency?.chainId
  const accountAddress = useActiveAddress(chainId)
  const activeWallet = useActiveWallet(chainId)
  const connector = (activeWallet as any)?.connector

  const submitButtonDisabled = useMemo(() => {
    const reasons: string[] = []
    const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false

    // Check for on-chain-only tx readiness
    const hasOnChainOnlyTx =
      isOnChainOnly &&
      isClassic(swapTxContext) &&
      !!(swapTxContext as any).txRequests?.length

    // Classic validation (requires gasFee + txRequests or permit)
    const validSwap = isValidSwapTxContext(swapTxContext)

    // Fine-grained gate logging
    if (!swapTxContext?.trade) {
      boundaryLogDeduped(
        '[SWAP-REVIEW] disable-gate',
        {
          tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
          extra: {
            chainId,
            gate: 'NO_TRADE',
            hasSwapTxContext: !!swapTxContext,
          },
        },
        chainId,
        {
          ttlMs: 5000,
          includeKeys: ['chainId', 'gate'],
        }
      )
    }

    if (!validSwap && !isWrap) {
      // For on-chain-only, allow if txRequests exist even if gasFee is not computed yet
      if (!hasOnChainOnlyTx) {
        reasons.push('INVALID_SWAP_TX_CONTEXT')
        boundaryLogDeduped(
          '[SWAP-REVIEW] disable-gate',
          {
            tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
            extra: {
              chainId,
              gate: 'INVALID_SWAP_TX_CONTEXT',
              validSwap,
              hasOnChainOnlyTx,
              hasTxRequests: !!(swapTxContext as any)?.txRequests?.length,
              gasFeeSummary: summarizeGasFee(swapTxContext?.gasFee),
            },
          },
          chainId,
          {
            ttlMs: 5000,
            includeKeys: ['chainId', 'gate'],
          }
        )
      }
    }

    const isTokenWarningBlocking = shouldDisplayTokenWarningCard && !tokenWarningChecked
    if (isTokenWarningBlocking) {
      reasons.push('TOKEN_WARNING_NOT_CHECKED')
      boundaryLogDeduped(
        '[SWAP-REVIEW] disable-gate',
        {
          tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
          extra: {
            chainId,
            gate: 'TOKEN_WARNING_NOT_CHECKED',
            shouldDisplayTokenWarningCard,
            tokenWarningChecked,
          },
        },
        chainId,
        {
          ttlMs: 5000,
          includeKeys: ['chainId', 'gate'],
        }
      )
    }

    if (blockingWarning) {
      reasons.push('BLOCKING_WARNING')
      boundaryLogDeduped(
        '[SWAP-REVIEW] disable-gate',
        {
          tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
          extra: {
            chainId,
            gate: 'BLOCKING_WARNING',
            blockingWarning: String(blockingWarning),
          },
        },
        chainId,
        {
          ttlMs: 5000,
          includeKeys: ['chainId', 'gate'],
        }
      )
    }

    if (newTradeRequiresAcceptance) {
      reasons.push('NEW_TRADE_REQUIRES_ACCEPTANCE')
      boundaryLogDeduped(
        '[SWAP-REVIEW] disable-gate',
        {
          tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
          extra: {
            chainId,
            gate: 'NEW_TRADE_REQUIRES_ACCEPTANCE',
          },
        },
        chainId,
        {
          ttlMs: 5000,
          includeKeys: ['chainId', 'gate'],
        }
      )
    }

    if (isSubmitting) {
      reasons.push('IS_SUBMITTING')
      boundaryLogDeduped(
        '[SWAP-REVIEW] disable-gate',
        {
          tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
          extra: {
            chainId,
            gate: 'IS_SUBMITTING',
          },
        },
        chainId,
        {
          ttlMs: 5000,
          includeKeys: ['chainId', 'gate'],
        }
      )
    }

    const isDisabled = reasons.length > 0

    // Comprehensive summary log before computing final disabled state
    const trade = swapTxContext?.trade
    const txRequests = (swapTxContext as any)?.txRequests
    const firstTxRequest = txRequests?.[0]
    const reasonsTextJoined = reasons.map(String).join('|')
    const reasonsString = reasonsTextJoined

    // Use deduped log to reduce spam (TTL: 3000ms, key includes reasonsString)
    boundaryLogDeduped(
      '[SWAP-REVIEW] disabled-computation',
      {
        tags: { file: 'SwapReviewFooter', function: 'useSwapSubmitButton' },
        extra: {
          chainId,
          accountAddress,
          connectorName: connector?.name,
          isOnChainOnly,
          hasTrade: !!trade,
          routing: trade?.routing ? String(trade.routing) : undefined,
          isWrap,
          hasSwapTxContext: !!swapTxContext,
          swapTxContextRouting: swapTxContext?.routing ? String(swapTxContext.routing) : undefined,
          txRequestsLength: txRequests?.length ?? 0,
          hasOnChainOnlyTx,
          validSwapTxContext: validSwap,
          reasonsString,
          gasFeeSummary: summarizeGasFee(swapTxContext?.gasFee),
          finalSubmitButtonDisabled: isDisabled,
          tradeSummary: summarizeTrade(trade),
          firstTxRequestSummary: summarizeTxRequest(firstTxRequest),
        },
      },
      chainId,
      {
        ttlMs: 3000,
        includeKeys: ['chainId', 'isOnChainOnly', 'reasonsString', 'blockingWarning'],
      }
    )

    return isDisabled
  }, [
    swapTxContext,
    isWrap,
    blockingWarning,
    newTradeRequiresAcceptance,
    isSubmitting,
    tokenWarningChecked,
    shouldDisplayTokenWarningCard,
    accountAddress,
    connector,
  ])

  return {
    disabled: submitButtonDisabled,
    showPendingUI,
    onSubmit: onSwapButtonClick,
    warning: reviewScreenWarning?.warning,
  }
}
