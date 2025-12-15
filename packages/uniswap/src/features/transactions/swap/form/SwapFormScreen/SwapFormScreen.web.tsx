import type { BottomSheetView } from '@gorhom/bottom-sheet'
import type { ComponentProps } from 'react'
import type { FlexProps } from 'ui/src'
import { Flex } from 'ui/src'
import { chainIdToPlatform } from 'uniswap/src/features/platforms/utils/chains'
import type { TransactionSettingConfig } from 'uniswap/src/features/transactions/components/settings/types'
import { filterSettingsByPlatform } from 'uniswap/src/features/transactions/components/settings/utils'
import { TransactionModalInnerContainer } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModal'
import { useTransactionModalContext } from 'uniswap/src/features/transactions/components/TransactionModal/TransactionModalContext'
import { SwapFormSettings } from 'uniswap/src/features/transactions/swap/components/SwapFormSettings/SwapFormSettings'
import { Slippage } from 'uniswap/src/features/transactions/swap/components/SwapFormSettings/settingsConfigurations/slippage/Slippage/Slippage'
import { TradeRoutingPreference } from 'uniswap/src/features/transactions/swap/components/SwapFormSettings/settingsConfigurations/TradeRoutingPreference/TradeRoutingPreference'
import { SwapFormCurrencyInputPanel } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapFormCurrencyInputPanel'
import { SwapFormCurrencyOutputPanel } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapFormCurrencyOutputPanel'
import { SwapFormDecimalPad } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapFormDecimalPad/SwapFormDecimalPad'
import { SwapFormHeader } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapFormHeader/SwapFormHeader'
import { SwapFormScreenDetails } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapFormScreenDetails/SwapFormScreenDetails'
import { SwapTokenSelector } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapTokenSelector/SwapTokenSelector'
import { SwitchCurrenciesButton } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/SwitchCurrenciesButton'
import { YouReceiveDetails } from 'uniswap/src/features/transactions/swap/form/SwapFormScreen/YouReceiveDetails/YouReceiveDetails'
import { SwapFormScreenStoreContextProvider } from 'uniswap/src/features/transactions/swap/form/stores/swapFormScreenStore/SwapFormScreenStoreContextProvider'
import { useSwapFormScreenStore } from 'uniswap/src/features/transactions/swap/form/stores/swapFormScreenStore/useSwapFormScreenStore'
import { usePriceUXEnabled } from 'uniswap/src/features/transactions/swap/hooks/usePriceUXEnabled'
import {
  useSwapFormStore,
  useSwapFormStoreDerivedSwapInfo,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { BridgeTrade } from 'uniswap/src/features/transactions/swap/types/trade'
import { isExtensionApp, isWebApp } from 'utilities/src/platform'
import { useRestrictedTokenAllowlistChecks } from 'uniswap/src/features/transactions/hooks/useRestrictedTokenAllowlistChecks'
import { getPoolAddressesFromTrade } from 'uniswap/src/features/transactions/hooks/getPoolAddressesFromTrade'
import { useActiveAddress } from 'uniswap/src/features/accounts/store/hooks'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyField } from 'uniswap/src/types/currency'
import { Address } from 'viem'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClassicTrade } from 'uniswap/src/features/transactions/swap/types/trade'
import type React from 'react'
import { Text } from 'ui/src'
import { AlertTriangleFilled } from 'ui/src/components/icons/AlertTriangleFilled'

interface SwapFormScreenProps {
  hideContent: boolean
  hideFooter?: boolean
  settings: TransactionSettingConfig[]
  tokenColor?: string
  focusHook?: ComponentProps<typeof BottomSheetView>['focusHook']
}

const EXIT_STYLE: FlexProps['exitStyle'] = { opacity: 0 }

/**
 * IMPORTANT: In the Extension, this component remains mounted when the user moves to the `SwapReview` screen.
 *            Make sure you take this into consideration when adding/modifying any hooks that run on this component.
 */
export function SwapFormScreen({
  hideContent,
  settings = [Slippage, TradeRoutingPreference],
  tokenColor,
  focusHook,
}: SwapFormScreenProps): JSX.Element {
  const { bottomSheetViewStyles } = useTransactionModalContext()
  const { selectingCurrencyField, hideSettings } = useSwapFormStore((s) => ({
    selectingCurrencyField: s.selectingCurrencyField,
    hideSettings: s.hideSettings,
  }))

  const { trade, chainId } = useSwapFormStoreDerivedSwapInfo((s) => ({ trade: s.trade, chainId: s.chainId }))

  const filteredSettings = filterSettingsByPlatform(settings, chainIdToPlatform(chainId))

  const showTokenSelector = !hideContent && !!selectingCurrencyField
  const isBridgeTrade = trade instanceof BridgeTrade

  return (
    <TransactionModalInnerContainer fullscreen bottomSheetViewStyles={bottomSheetViewStyles}>
      {!isWebApp && <SwapFormHeader /> /* Interface renders its own header with multiple tabs */}
      {!hideSettings && <SwapFormSettings settings={filteredSettings} isBridgeTrade={isBridgeTrade} />}

      {!hideContent && (
        <SwapFormScreenStoreContextProvider tokenColor={tokenColor}>
          <SwapFormContent />
        </SwapFormScreenStoreContextProvider>
      )}

      <SwapTokenSelector isModalOpen={showTokenSelector} focusHook={focusHook} />
    </TransactionModalInnerContainer>
  )
}

function SwapFormContent(): JSX.Element {
  const { trade, isCrossChain } = useSwapFormScreenStore((state) => ({
    trade: state.trade,
    isCrossChain: state.isCrossChain,
  }))

  const priceUXEnabled = usePriceUXEnabled()
  const { t } = useTranslation()
  
  // Get tokens and chain info for allowlist checks
  const derivedSwapInfo = useSwapFormStoreDerivedSwapInfo((s) => s)
  const accountAddress = useActiveAddress(derivedSwapInfo.chainId)
  const inputToken = derivedSwapInfo.currencies[CurrencyField.INPUT]?.currency
  const outputToken = derivedSwapInfo.currencies[CurrencyField.OUTPUT]?.currency
  const chainId = derivedSwapInfo.chainId as EVMUniverseChainId | undefined

  // Extract pool addresses from trade route (for multi-hop swaps)
  const poolAddresses = useMemo(() => {
    const tradeInstance = derivedSwapInfo.trade.trade
    if (tradeInstance && 'routing' in tradeInstance && tradeInstance.routing === 'CLASSIC') {
      return getPoolAddressesFromTrade(tradeInstance as ClassicTrade, chainId)
    }
    return []
  }, [derivedSwapInfo.trade.trade, chainId])

  // Use the consolidated hook for allowlist checks
  const allowlistChecks = useRestrictedTokenAllowlistChecks({
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

  const isLoading = allowlistChecks.isLoading

  // Debug logging to help diagnose why warnings might not show
  if (process.env.NODE_ENV !== 'production') {
    console.log('[SwapFormScreen.web] Allowlist checks state', {
      restrictedTokensCount: allowlistChecks.debug.restrictedTokens.length,
      blockingWarningsCount: allowlistChecks.blockingWarnings.length,
      nonBlockingWarningsCount: allowlistChecks.nonBlockingWarnings.length,
      isLoading,
      hasAccount: !!accountAddress,
      hasChain: !!chainId,
      hasInputToken: !!inputToken,
      hasOutputToken: !!outputToken,
      restrictedTokens: allowlistChecks.debug.restrictedTokens,
      allChecks: allowlistChecks.debug.checked.length,
    })
  }

  // Separate wallet checks from other address checks - same pattern as liquidity flow
  const { walletStatus, otherAddressWarnings } = useMemo(() => {
    // Find wallet check status
    const walletChecks = allowlistChecks.debug.checked.filter((check) => check.subjectLabel === 'Wallet')
    const walletCheck = walletChecks.length > 0 ? walletChecks[0] : null
    const walletIsAllowed = walletCheck?.isAllowed === true
    const walletIsLoading = walletChecks.length === 0 && isLoading

    // Get warnings for non-wallet addresses only
    const nonWalletWarnings = [
      ...allowlistChecks.blockingWarnings.filter((w) => w.subjectLabel !== 'Wallet'),
      ...allowlistChecks.nonBlockingWarnings.filter((w) => w.subjectLabel !== 'Wallet'),
    ]

    // Build warning message for non-wallet addresses - same pattern as liquidity flow
    let otherAddressMessage: string | undefined = undefined
    if (nonWalletWarnings.length > 0) {
      const warningsByToken = new Map<string, Array<{ label: string; address: string }>>()
      
      for (const warning of nonWalletWarnings) {
        const tokenKey = warning.tokenSymbol || warning.tokenAddress
        if (!warningsByToken.has(tokenKey)) {
          warningsByToken.set(tokenKey, [])
        }
        warningsByToken.get(tokenKey)!.push({
          label: warning.subjectLabel,
          address: warning.subjectAddress,
        })
      }

      const parts: string[] = []
      for (const [tokenSymbol, addresses] of warningsByToken.entries()) {
        if (addresses.length > 0) {
          // Deduplicate addresses by address
          const uniqueAddresses = Array.from(
            new Map(addresses.map((a) => [a.address, a])).values()
          )
          
          parts.push(`The following addresses are not whitelisted for ${tokenSymbol}:`)
          const addressList = uniqueAddresses.map((a) => `• ${a.label}: ${a.address}`).join('\n')
          parts.push(addressList)
          parts.push('')
          parts.push('Please contact your system administrator to whitelist these addresses.')
        }
      }

      otherAddressMessage = parts.join('\n\n')
    }

    return {
      walletStatus: {
        isAllowed: walletIsAllowed,
        isLoading: walletIsLoading,
        check: walletCheck,
      },
      otherAddressWarnings: otherAddressMessage,
    }
  }, [allowlistChecks, isLoading])

  // Block if wallet is not allowed OR if other addresses are not allowed
  const hasWhitelistRestriction = useMemo(() => {
    if (walletStatus.isLoading) return false // Don't block while loading
    if (walletStatus.check && walletStatus.check.isAllowed === false) return true // Block if wallet not allowed
    if (otherAddressWarnings) return true // Block if other addresses not allowed
    return false
  }, [walletStatus, otherAddressWarnings])

  // Import ErrorCallout for web - using dynamic import that will be resolved by web app's module resolution
  // This import path works because web app has path aliases configured
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const ErrorCallout = require('components/ErrorCallout')?.ErrorCallout as React.ComponentType<{
    errorMessage: boolean | string
    description?: string
    title?: string
    isWarning?: boolean
  }> | undefined

  return (
    <Flex grow gap="$spacing8" justifyContent="space-between">
      <Flex gap="$spacing4" animation="quick" exitStyle={EXIT_STYLE} grow={isExtensionApp}>
        <Flex gap="$spacing2">
          <SwapFormCurrencyInputPanel />
          <SwitchCurrenciesButton />
          <SwapFormCurrencyOutputPanel />
        </Flex>

        <Flex>
          {priceUXEnabled && (
            <YouReceiveDetails
              isIndicative={Boolean(trade.indicativeTrade && !trade.trade)}
              isLoadingIndicative={trade.isIndicativeLoading}
              isLoading={Boolean(trade.isFetching)}
              isBridge={isCrossChain}
            />
          )}
          <SwapFormScreenDetails />
        </Flex>

        {/* Persistent warning section underneath swap widget - same pattern as liquidity flow */}
        {/* DEBUG: Always show a test element to verify component is rendering */}
        {process.env.NODE_ENV !== 'production' && (
          <Flex backgroundColor="$surface2" p="$padding8" borderRadius="$rounded8" borderWidth={1} borderColor="$statusWarning">
            <Text variant="body3" color="$neutral1">
              [DEBUG] SwapFormScreen.web.tsx is rendering. Restricted tokens: {allowlistChecks.debug.restrictedTokens.length}, 
              Blocking: {allowlistChecks.blockingWarnings.length}, 
              Non-blocking: {allowlistChecks.nonBlockingWarnings.length}, 
              Loading: {isLoading ? 'true' : 'false'}, 
              Checks: {allowlistChecks.debug.checked.length},
              Account: {accountAddress ? 'yes' : 'no'},
              Chain: {chainId || 'none'},
              InputToken: {inputToken?.symbol || 'none'},
              OutputToken: {outputToken?.symbol || 'none'}
            </Text>
          </Flex>
        )}
        {/* Show when there are restricted tokens - simplified condition */}
        {/* Always show if there are restricted tokens OR if we're checking (loading) */}
        {(allowlistChecks.debug.restrictedTokens.length > 0 || isLoading) && (
          <Flex gap="$spacing12" backgroundColor="$surface1" p="$padding16" borderRadius="$rounded16" borderWidth={2} borderColor="$statusCritical">
            {/* Wallet KYC status - show separately */}
            {!walletStatus.isLoading && walletStatus.check && (
              <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
                <Flex
                  backgroundColor={walletStatus.isAllowed ? '$statusSuccess2' : '$statusCritical2'}
                  p="$padding12"
                  borderRadius="$rounded12"
                  alignSelf="flex-start"
                >
                  {walletStatus.isAllowed ? (
                    <Text color="$statusSuccess" fontSize={20}>✓</Text>
                  ) : (
                    <AlertTriangleFilled color="$statusCritical" size="$icon.20" />
                  )}
                </Flex>
                <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                  <Text 
                    color={walletStatus.isAllowed ? '$statusSuccess' : '$statusCritical'} 
                    variant="body3"
                    fontWeight="600"
                  >
                    {walletStatus.isAllowed 
                      ? 'Wallet KYC\'d and allowed ✓'
                      : 'Wallet not authorized'}
                  </Text>
                  {!walletStatus.isAllowed && (
                    <Text variant="body3" color="$neutral2">
                      You need to complete KYC verification to allow your wallet for trading. Please contact your system administrator to submit your wallet for KYC approval.
                    </Text>
                  )}
                </Flex>
              </Flex>
            )}

            {/* Loading state for wallet check */}
            {walletStatus.isLoading && (
              <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
                <Flex
                  backgroundColor="$statusWarning2"
                  p="$padding12"
                  borderRadius="$rounded12"
                  alignSelf="flex-start"
                >
                  <AlertTriangleFilled color="$statusWarning" size="$icon.20" />
                </Flex>
                <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                  <Text color="$statusWarning" variant="body3" fontWeight="600">
                    Checking wallet authorization status...
                  </Text>
                </Flex>
              </Flex>
            )}

            {/* Other address warnings (Quoter, Router, etc.) - only show if there are non-wallet issues */}
            {otherAddressWarnings && ErrorCallout && (
              <ErrorCallout
                errorMessage={true}
                isWarning={false}
                title={t('position.whitelistRestriction.title')}
                description={otherAddressWarnings}
              />
            )}

            {/* Fallback: Show message even if no specific warnings yet */}
            {!walletStatus.check && !walletStatus.isLoading && !otherAddressWarnings && allowlistChecks.debug.restrictedTokens.length > 0 && (
              <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
                <Flex
                  backgroundColor="$statusWarning2"
                  p="$padding12"
                  borderRadius="$rounded12"
                  alignSelf="flex-start"
                >
                  <AlertTriangleFilled color="$statusWarning" size="$icon.20" />
                </Flex>
                <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                  <Text color="$statusWarning" variant="body3" fontWeight="600">
                    Restricted token detected: {allowlistChecks.debug.restrictedTokens.map((t) => t.symbol || t.address).join(', ')}
                  </Text>
                  <Text variant="body3" color="$neutral2">
                    Checking allowlist status...
                  </Text>
                </Flex>
              </Flex>
            )}
          </Flex>
        )}
      </Flex>
      <SwapFormDecimalPad />
    </Flex>
  )
}

