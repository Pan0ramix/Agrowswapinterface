import { TFunction } from 'i18next'
import { Warning, WarningAction, WarningLabel, WarningSeverity } from 'uniswap/src/components/modals/WarningModal/types'
import type { TokenWhitelistStatus } from 'uniswap/src/features/transactions/hooks/useTokenWhitelistStatus'
import { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import { CurrencyField } from 'uniswap/src/types/currency'

export function getTokenWhitelistWarning(
  t: TFunction,
  currencies: DerivedSwapInfo['currencies'],
  inputTokenStatus: TokenWhitelistStatus | undefined,
  outputTokenStatus: TokenWhitelistStatus | undefined,
  swapRouterNotWhitelisted?: boolean,
  swapRouterAddress?: string,
  permit2NotWhitelisted?: boolean,
  swapRouterStatusUnknown?: boolean,
  permit2StatusUnknown?: boolean,
): Warning | undefined {
  const inputToken = currencies[CurrencyField.INPUT]?.currency
  const outputToken = currencies[CurrencyField.OUTPUT]?.currency

  // Check if any token is restricted and wallet is not allowed
  const isInputRestrictedNotAllowed = inputTokenStatus?.isRestricted && !inputTokenStatus.isAllowed
  const isOutputRestrictedNotAllowed = outputTokenStatus?.isRestricted && !outputTokenStatus.isAllowed

  // Check if swap router is not whitelisted (highest priority warning)
  if (swapRouterNotWhitelisted && swapRouterAddress) {
    return {
      type: WarningLabel.TokenWhitelistRestricted,
      severity: WarningSeverity.Blocked,
      action: WarningAction.DisableReview,
      title: t('swap.warning.tokenWhitelist.swapRouterNotWhitelistedTitle'),
      message: t('swap.warning.tokenWhitelist.swapRouterNotWhitelisted', {
        routerAddress: swapRouterAddress,
      }),
      buttonText: t('swap.warning.tokenWhitelistFallback.button'),
    }
  }

  // Check if swap router status is unknown
  if (swapRouterStatusUnknown && swapRouterAddress) {
    return {
      type: WarningLabel.TokenWhitelistRestricted,
      severity: WarningSeverity.Blocked,
      action: WarningAction.DisableReview,
      title: t('swap.warning.tokenWhitelist.swapRouterStatusUnknownTitle'),
      message: t('swap.warning.tokenWhitelist.swapRouterStatusUnknown', {
        routerAddress: swapRouterAddress,
      }),
      buttonText: t('swap.warning.tokenWhitelistFallback.button'),
    }
  }

  // Check if Permit2 is not whitelisted (high priority warning)
  if (permit2NotWhitelisted) {
    return {
      type: WarningLabel.TokenWhitelistRestricted,
      severity: WarningSeverity.Blocked,
      action: WarningAction.DisableReview,
      title: t('swap.warning.tokenWhitelist.permit2NotWhitelistedTitle'),
      message: t('swap.warning.tokenWhitelist.permit2NotWhitelisted'),
      buttonText: t('swap.warning.tokenWhitelistFallback.button'),
    }
  }

  // Check if Permit2 status is unknown
  if (permit2StatusUnknown) {
    return {
      type: WarningLabel.TokenWhitelistRestricted,
      severity: WarningSeverity.Blocked,
      action: WarningAction.DisableReview,
      title: t('swap.warning.tokenWhitelist.permit2StatusUnknownTitle'),
      message: t('swap.warning.tokenWhitelist.permit2StatusUnknown'),
      buttonText: t('swap.warning.tokenWhitelistFallback.button'),
    }
  }

  if (!isInputRestrictedNotAllowed && !isOutputRestrictedNotAllowed) {
    return undefined
  }

  // Determine which token(s) are causing the issue
  const restrictedTokenSymbol = isInputRestrictedNotAllowed ? inputToken?.symbol : outputToken?.symbol

  const buttonText = t('swap.warning.tokenWhitelist.button', {
    tokenSymbol: restrictedTokenSymbol ?? '',
  })

  return {
    type: WarningLabel.TokenWhitelistRestricted,
    severity: WarningSeverity.Blocked,
    action: WarningAction.DisableReview,
    title: t('swap.warning.tokenWhitelist.title'),
    message: t('swap.warning.tokenWhitelist.message'),
    buttonText: !restrictedTokenSymbol ? t('swap.warning.tokenWhitelistFallback.button') : buttonText,
  }
}
