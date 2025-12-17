import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { nativeOnChain } from 'uniswap/src/constants/tokens'
import { useConnectionStatus } from 'uniswap/src/features/accounts/store/hooks'
import { isSVMChain } from 'uniswap/src/features/platforms/utils/chains'
import { useIsWebFORNudgeEnabled } from 'uniswap/src/features/providers/webForNudgeProvider'
import { useTransactionSettingsActions } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { useTransactionModalContext } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import { useIsAmountSelectionInvalid } from 'uniswap/src/features/transactions/swap/components/SwapFormButton/hooks/useIsAmountSelectionInvalid'
import { useIsMissingPlatformWallet } from 'uniswap/src/features/transactions/swap/components/SwapFormButton/hooks/useIsMissingPlatformWallet'
import { useIsTokenSelectionInvalid } from 'uniswap/src/features/transactions/swap/components/SwapFormButton/hooks/useIsTokenSelectionInvalid'
import { useIsTradeIndicative } from 'uniswap/src/features/transactions/swap/components/SwapFormButton/hooks/useIsTradeIndicative'
import { useParsedSwapWarnings } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/useSwapWarnings'
import { getActionText } from 'uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapReviewFooter/SubmitSwapButton'
import { useSwapFormStoreDerivedSwapInfo } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { CurrencyField } from 'uniswap/src/types/currency'

/**
 * Hook to reset slippage tolerance to default (auto)
 * Returns a function that can be called to reset slippage
 */
export function useResetSlippageToDefault(): () => void {
  const { setCustomSlippageTolerance } = useTransactionSettingsActions()
  return useCallback(() => {
    setCustomSlippageTolerance(undefined)
  }, [setCustomSlippageTolerance])
}

export const useSwapFormButtonText = (): string => {
  const { t } = useTranslation()
  const { swapRedirectCallback } = useTransactionModalContext()
  const { currencies, wrapType, chainId } = useSwapFormStoreDerivedSwapInfo((s) => ({
    currencies: s.currencies,
    wrapType: s.wrapType,
    chainId: s.chainId,
  }))
  const isTokenSelectionInvalid = useIsTokenSelectionInvalid()
  const isAmountSelectionInvalid = useIsAmountSelectionInvalid()

  const { isDisconnected } = useConnectionStatus()
  const isMissingPlatformWallet = useIsMissingPlatformWallet(chainId)

  const isEmbeddedWalletEnabled = useFeatureFlag(FeatureFlags.EmbeddedWallet)
  const { insufficientBalanceWarning, blockingWarning, insufficientGasFundsWarning } = useParsedSwapWarnings()
  const { onChainQuote } = useSwapFormStoreDerivedSwapInfo((s) => ({
    onChainQuote: s.onChainQuote,
  }))

  // Check if swap quote is blocked (invalid slippage, etc.)
  const isQuoteBlocked = onChainQuote?.blockedReason !== undefined || onChainQuote?.isValid === false

  const isLogIn = isEmbeddedWalletEnabled

  const nativeCurrency = nativeOnChain(chainId)

  const isIndicative = useIsTradeIndicative()
  const isWebFORNudgeEnabled = useIsWebFORNudgeEnabled()
  const isWrap = wrapType !== WrapType.NotApplicable

  if (swapRedirectCallback) {
    return t('common.getStarted')
  }

  if (isWebFORNudgeEnabled) {
    return t('empty.swap.button.text')
  }

  // Show blocked message if quote is blocked (invalid slippage, etc.)
  if (isQuoteBlocked && onChainQuote.blockedReason) {
    // Extract message from blocked reason
    if (onChainQuote.blockedReason.type === 'INVALID_SLIPPAGE') {
      return t('swap.error.invalidSlippage', { defaultValue: 'Invalid slippage setting' })
    }
    return onChainQuote.blockedReason.message || t('swap.error.blocked', { defaultValue: 'Swap blocked' })
  }

  if (isIndicative) {
    return t('swap.finalizingQuote')
  }

  if (isDisconnected) {
    return isLogIn ? t('nav.logIn.button') : t('common.connectWallet.button')
  }

  if (isMissingPlatformWallet) {
    return t('common.connectTo', { platform: isSVMChain(chainId) ? 'Solana' : 'Ethereum' })
  }

  if (blockingWarning?.buttonText) {
    return blockingWarning.buttonText
  }

  if (isTokenSelectionInvalid) {
    return t('common.selectToken.label')
  }

  if (isAmountSelectionInvalid) {
    return t('common.noAmount.error')
  }

  if (insufficientBalanceWarning) {
    return t('common.insufficientTokenBalance.error.simple', {
      tokenSymbol: currencies[CurrencyField.INPUT]?.currency.symbol ?? '',
    })
  }

  if (insufficientGasFundsWarning) {
    return t('common.insufficientTokenBalance.error.simple', { tokenSymbol: nativeCurrency.symbol ?? '' })
  }

  if (isWrap) {
    return getActionText({ t, wrapType })
  }

  return t('swap.button.review')
}
