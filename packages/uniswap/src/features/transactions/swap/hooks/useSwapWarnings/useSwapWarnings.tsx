import type { TFunction } from 'i18next'
import isEqual from 'lodash/isEqual'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { ParsedWarnings, Warning } from 'uniswap/src/components/modals/WarningModal/types'
import { WarningAction, WarningLabel, WarningSeverity } from 'uniswap/src/components/modals/WarningModal/types'
import { useUniswapContext } from 'uniswap/src/contexts/UniswapContext'
import { useActiveAddress } from 'uniswap/src/features/accounts/store/hooks'
import { useTransactionGasWarning } from 'uniswap/src/features/gas/hooks'
import type { LocalizationContextState } from 'uniswap/src/features/language/LocalizationContext'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import {
  getNetworkWarning,
  useFormattedWarnings,
} from 'uniswap/src/features/transactions/hooks/useParsedTransactionWarnings'
import { getBalanceWarning } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/getBalanceWarning'
import { getFormIncompleteWarning } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/getFormIncompleteWarning'
import { getPriceImpactWarning } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/getPriceImpactWarning'
import { getSwapWarningFromError } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/getSwapWarningFromError'
import { getTokenBlockedWarning } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/getTokenBlockedWarning'
import { getTokenWhitelistWarning } from 'uniswap/src/features/transactions/swap/hooks/useSwapWarnings/getTokenWhitelistWarning'
import { useSwapFormStore } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { useSwapTxStore } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/useSwapTxStore'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import { getPriceImpact } from 'uniswap/src/features/transactions/swap/utils/getPriceImpact'
import { useIsOffline } from 'utilities/src/connection/useIsOffline'
import { useRestrictedTokenWarnings } from 'uniswap/src/features/transactions/hooks/useRestrictedTokenWarnings'
import { getPoolAddressesFromTrade } from 'uniswap/src/features/transactions/hooks/getPoolAddressesFromTrade'
import { ClassicTrade } from 'uniswap/src/features/transactions/swap/types/trade'
import { useMemoCompare } from 'utilities/src/react/hooks'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyField } from 'uniswap/src/types/currency'
import { Address } from 'viem'
import { PERMIT2_ADDRESS } from '@uniswap/permit2-sdk'

export function getSwapWarnings({
  t,
  formatPercent,
  derivedSwapInfo,
  offline,
}: {
  t: TFunction
  formatPercent: LocalizationContextState['formatPercent']
  derivedSwapInfo: DerivedSwapInfo
  offline: boolean
}): Warning[] {
  const warnings: Warning[] = []

  if (offline) {
    warnings.push(getNetworkWarning(t))
  }

  const { trade } = derivedSwapInfo

  // token is blocked
  const tokenBlockedWarning = getTokenBlockedWarning(t, derivedSwapInfo.currencies)
  if (tokenBlockedWarning) {
    warnings.push(tokenBlockedWarning)
  }

  // insufficient balance for swap
  const balanceWarning = getBalanceWarning({
    t,
    currencyBalances: derivedSwapInfo.currencyBalances,
    currencyAmounts: derivedSwapInfo.currencyAmounts,
  })
  if (balanceWarning) {
    warnings.push(balanceWarning)
  }

  if (trade.error) {
    warnings.push(getSwapWarningFromError({ error: trade.error, t, derivedSwapInfo }))
  }

  // swap form is missing input, output fields
  const formIncompleteWarning = getFormIncompleteWarning(derivedSwapInfo)
  if (formIncompleteWarning) {
    warnings.push(formIncompleteWarning)
  }

  // price impact warning
  const priceImpact = getPriceImpact(derivedSwapInfo)
  const priceImpactWarning = getPriceImpactWarning({
    t,
    priceImpact,
    formatPercent,
    currencies: derivedSwapInfo.currencies,
  })
  if (priceImpactWarning) {
    warnings.push(priceImpactWarning)
  }

  return warnings
}

function useSwapWarnings(derivedSwapInfo: DerivedSwapInfo): Warning[] {
  const { t } = useTranslation()
  const { formatPercent } = useLocalizationContext()
  const offline = useIsOffline()

  return useMemoCompare(() => getSwapWarnings({ t, formatPercent, derivedSwapInfo, offline }), isEqual)
}

export function useParsedSwapWarnings(): ParsedWarnings {
  const derivedSwapInfo = useSwapFormStore((s) => s.derivedSwapInfo)
  const { t } = useTranslation()

  const accountAddress = useActiveAddress(derivedSwapInfo.chainId)

  const gasFee = useSwapTxStore((s) => s.gasFee)

  const swapWarnings = useSwapWarnings(derivedSwapInfo)

  // Extract tokens and chain info
  const inputToken = derivedSwapInfo.currencies[CurrencyField.INPUT]?.currency
  const outputToken = derivedSwapInfo.currencies[CurrencyField.OUTPUT]?.currency
  const chainId = derivedSwapInfo.chainId as EVMUniverseChainId | undefined

  // Extract pool addresses from trade route (for multi-hop swaps)
  const poolAddresses = useMemo(() => {
    const trade = derivedSwapInfo.trade.trade
    if (trade && 'routing' in trade && trade.routing === 'CLASSIC') {
      return getPoolAddressesFromTrade(trade as ClassicTrade, chainId)
    }
    return []
  }, [derivedSwapInfo.trade.trade, chainId])

  // Use the shared warnings hook (cross-platform)
  const warnings = useRestrictedTokenWarnings({
    account: accountAddress as Address | undefined,
    chainId,
    tokens: {
      tokenA: inputToken,
      tokenB: outputToken,
    },
    flow: 'swap',
    poolAddresses: poolAddresses.length > 0 ? poolAddresses : undefined,
    enabled: !!accountAddress && !!chainId && (!!inputToken || !!outputToken),
  })

  // Convert warnings to legacy format for compatibility with existing warning system
  const allowlistChecks = useMemo(() => ({
    isBlocked: warnings.isBlocked,
    blockingWarnings: warnings.warnings.filter((w) => w.severity === 'blocking').map((w) => ({
      tokenAddress: w.tokenAddress,
      tokenSymbol: w.tokenSymbol,
      subjectAddress: w.address,
      subjectLabel: w.subjectLabel,
      message: '', // Not used in this context
    })),
    nonBlockingWarnings: warnings.warnings.filter((w) => w.severity === 'warning').map((w) => ({
      tokenAddress: w.tokenAddress,
      tokenSymbol: w.tokenSymbol,
      subjectAddress: w.address,
      subjectLabel: w.subjectLabel,
      message: '', // Not used in this context
    })),
    debug: {
      restrictedTokens: warnings.restrictedTokens,
      checked: warnings.subjects.map((s) => ({
        tokenAddress: s.tokenAddress,
        tokenSymbol: s.tokenSymbol,
        subjectAddress: s.address,
        subjectLabel: s.type,
        isAllowed: s.isAllowed,
        error: s.error,
      })),
    },
  }), [warnings])

  // Convert allowlist checks to warning format
  const whitelistWarning = useMemo(() => {
    if (allowlistChecks.blockingWarnings.length === 0 && allowlistChecks.nonBlockingWarnings.length === 0) {
      return undefined
    }

    // Check for quoter-specific warnings
    const quoterWarnings = allowlistChecks.blockingWarnings.filter((w) => w.subjectLabel === 'Quoter')
    const otherWarnings = allowlistChecks.blockingWarnings.filter((w) => w.subjectLabel !== 'Quoter')
    const nonBlockingWarnings = allowlistChecks.nonBlockingWarnings

    // If there are quoter warnings, show a specific message
    if (quoterWarnings.length > 0) {
      const quoterWarning = quoterWarnings[0] // Take first quoter warning
      const tokenSymbol = quoterWarning.tokenSymbol || quoterWarning.tokenAddress
      const quoterAddress = quoterWarning.subjectAddress

      return {
        type: WarningLabel.TokenWhitelistRestricted,
        severity: WarningSeverity.Blocked,
        action: WarningAction.DisableReview,
        title: t('swap.warning.tokenWhitelist.quoterNotWhitelistedTitle', {
          defaultValue: 'Quote unavailable',
        }),
        message: t('swap.warning.tokenWhitelist.quoterNotWhitelisted', {
          token: tokenSymbol,
          quoterAddress,
          defaultValue: `Quote unavailable: Quoter is not allowlisted for ${tokenSymbol}. Ask admin to whitelist: ${quoterAddress}`,
        }),
        buttonText: t('swap.warning.tokenWhitelistFallback.button'),
      } as Warning
    }

    // Group other warnings by token
    const warningsByToken = new Map<
      string,
      Array<{ subjectLabel: string; subjectAddress: Address; message: string }>
    >()

    for (const warning of [...otherWarnings, ...nonBlockingWarnings]) {
      const key = warning.tokenAddress
      if (!warningsByToken.has(key)) {
        warningsByToken.set(key, [])
      }
      warningsByToken.get(key)!.push({
        subjectLabel: warning.subjectLabel,
        subjectAddress: warning.subjectAddress,
        message: warning.message,
      })
    }

    // Build warning message
    const tokenMessages: string[] = []
    for (const [tokenAddress, warnings] of warningsByToken.entries()) {
      const tokenSymbol = warnings[0]?.message.match(/for (\w+)/)?.[1] || tokenAddress
      const subjectList = warnings.map((w) => `${w.subjectLabel} (${w.subjectAddress})`).join(', ')
      tokenMessages.push(`${tokenSymbol}: ${subjectList}`)
    }

    const isBlocking = allowlistChecks.isBlocked

    return {
      type: WarningLabel.TokenWhitelistRestricted,
      severity: isBlocking ? WarningSeverity.Blocked : WarningSeverity.Medium,
      action: isBlocking ? WarningAction.DisableReview : WarningAction.None,
      title: t('swap.warning.tokenWhitelist.title'),
      message: t('swap.warning.tokenWhitelist.restrictedTokenAllowlistRequirement', {
        tokens: tokenMessages.join('; '),
        defaultValue: `Restricted token allowlist requirement: ${tokenMessages.join('; ')}`,
      }),
      buttonText: t('swap.warning.tokenWhitelistFallback.button'),
    } as Warning
  }, [allowlistChecks, t])

  // Check if current wallet can pay gas fees in any token
  const { getCanPayGasInAnyToken } = useUniswapContext()
  const skipGasCheck = getCanPayGasInAnyToken?.()

  const gasWarning = useTransactionGasWarning({
    accountAddress,
    derivedInfo: derivedSwapInfo,
    gasFee: gasFee.value,
    skipGasCheck,
  })

  const allWarnings = useMemo(() => {
    const warnings = [...swapWarnings]
    if (whitelistWarning) {
      warnings.push(whitelistWarning)
    }
    if (gasWarning) {
      warnings.push(gasWarning)
    }
    return warnings
  }, [gasWarning, swapWarnings, whitelistWarning])

  return useFormattedWarnings(allWarnings)
}
