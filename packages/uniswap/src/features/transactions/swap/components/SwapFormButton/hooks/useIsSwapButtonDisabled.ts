import { useActiveAddress, useActiveWallet } from 'uniswap/src/features/accounts/store/hooks'
import { SigningCapability } from 'uniswap/src/features/accounts/store/types/Wallet'
import { useIsShowingWebFORNudge, useIsWebFORNudgeEnabled } from 'uniswap/src/features/providers/webForNudgeProvider'
import { useTransactionModalContext } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import { useIsMissingPlatformWallet } from 'uniswap/src/features/transactions/swap/components/SwapFormButton/hooks/useIsMissingPlatformWallet'
import { useParsedSwapWarnings } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/useSwapWarnings'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import {
  useSwapFormStore,
  useSwapFormStoreDerivedSwapInfo,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { useIsBlocked } from 'uniswap/src/features/trm/hooks'
import { boundaryLogDeduped } from 'uniswap/src/utils/boundaryLog'

const useIsReviewButtonDisabled = (): boolean => {
  const isSubmitting = useSwapFormStore((s) => s.isSubmitting)
  const { isTradeMissing, chainId, onChainQuote } = useSwapFormStoreDerivedSwapInfo((s) => ({
    isTradeMissing: !s.trade.trade,
    chainId: s.chainId,
    onChainQuote: s.onChainQuote,
  }))

  const activeAccountAddress = useActiveAddress(chainId)
  const isMissingPlatformWallet = useIsMissingPlatformWallet(chainId)

  const { blockingWarning } = useParsedSwapWarnings()
  const { isBlocked: isBlockedAccount, isBlockedLoading: isBlockedAccountLoading } = useIsBlocked(activeAccountAddress)
  const { walletNeedsRestore } = useTransactionModalContext()

  // Check if swap quote is blocked (invalid slippage, etc.)
  const isQuoteBlocked = onChainQuote?.data?.blockedReason !== undefined || onChainQuote?.data?.isValid === false

  // Build structured reasons array
  const reasons: string[] = []
  if (blockingWarning) reasons.push('BLOCKING_WARNING')
  if (isBlockedAccount) reasons.push('BLOCKED_ACCOUNT')
  if (isBlockedAccountLoading) reasons.push('BLOCKED_ACCOUNT_LOADING')
  if (walletNeedsRestore) reasons.push('WALLET_NEEDS_RESTORE')
  if (isSubmitting) reasons.push('IS_SUBMITTING')
  if (isTradeMissing) reasons.push('NO_TRADE')
  if (isMissingPlatformWallet) reasons.push('MISSING_PLATFORM_WALLET')
  if (isQuoteBlocked) reasons.push('INVALID_SLIPPAGE_OR_BLOCKED_QUOTE')

  const disabled = reasons.length > 0
  const reasonsString = reasons.join('|')

  // Use deduped log to reduce spam (TTL: 3000ms, key includes reasonsString)
  boundaryLogDeduped(
    '[SWAP-BUTTON] disabled state',
    {
      tags: { file: 'useIsSwapButtonDisabled', function: 'useIsReviewButtonDisabled' },
      extra: {
        chainId,
        isOnChainOnly: isOnChainOnlyChain(chainId),
        reasonsString,
        blockingWarning: !!blockingWarning,
        isBlockedAccount,
        isBlockedAccountLoading,
        walletNeedsRestore,
        isSubmitting,
        isTradeMissing,
        isMissingPlatformWallet,
      },
    },
    chainId,
    {
      ttlMs: 3000,
      includeKeys: ['chainId', 'isOnChainOnly', 'reasonsString', 'blockingWarning'],
    },
  )

  return disabled
}

// TODO(WEB-5090): Simplify logic, deduplicate disabled vs isReviewButtonDisabled
export const useIsSwapButtonDisabled = (): boolean => {
  const isReviewButtonDisabled = useIsReviewButtonDisabled()
  const { swapRedirectCallback } = useTransactionModalContext()

  const chainId = useSwapFormStoreDerivedSwapInfo((s) => s.chainId)

  const activeWallet = useActiveWallet(chainId)
  const walletCannotSign = activeWallet?.signingCapability === SigningCapability.None

  const isWebFORNudgeEnabled = useIsWebFORNudgeEnabled()
  const isShowingWebFORNudge = useIsShowingWebFORNudge()

  if (isWebFORNudgeEnabled && isShowingWebFORNudge) {
    return true
  } else if (isWebFORNudgeEnabled && !isShowingWebFORNudge) {
    return false
  }
  return (
    // Only disable if the wallet is connected, review button is disabled, wallet is a signable-wallet, and there is no swap redirect callback

    !!activeWallet && // don't disable the button if unconnected because they need to click it to connect
    isReviewButtonDisabled && // the main disabling logic
    !walletCannotSign && // don't disable if wallet is viewonly because wallet app wants to allow clicking so it can pop up a "this wallet is view only"
    !swapRedirectCallback
  ) // never disable the button if there is a callback to click it
}
