/**
 * Cross-platform component for displaying restricted token warnings
 *
 * This component renders warnings about restricted tokens and allowlist status.
 * It uses platform-agnostic UI primitives and can be wrapped with platform-specific
 * layout components if needed.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flex, Text, TouchableArea } from 'ui/src'
import { AlertTriangleFilled } from 'ui/src/components/icons/AlertTriangleFilled'
import { setClipboard } from 'uniswap/src/utils/clipboard'
import type { RestrictedTokenWarnings as RestrictedTokenWarningsType } from 'uniswap/src/features/transactions/hooks/useRestrictedTokenWarnings'

interface RestrictedTokenWarningsProps {
  warnings: RestrictedTokenWarningsType
  showWalletStatus?: boolean
  showOtherWarnings?: boolean
}

/**
 * Shared component for rendering restricted token warnings
 * Platform-specific wrappers can be added if needed for layout differences
 */
export function RestrictedTokenWarnings({
  warnings,
  showWalletStatus = true,
  showOtherWarnings = true,
}: RestrictedTokenWarningsProps): JSX.Element | null {
  const { t } = useTranslation()

  // Separate wallet warnings from other warnings - must call hooks before conditional return
  const walletWarnings = useMemo(() => {
    return warnings.warnings.filter((w) => w.addressType === 'wallet')
  }, [warnings.warnings])

  const otherWarnings = useMemo(() => {
    return warnings.warnings.filter((w) => w.addressType !== 'wallet')
  }, [warnings.warnings])

  // Group other warnings by token for better display
  const warningsByToken = useMemo(() => {
    const map = new Map<string, typeof otherWarnings>()
    for (const warning of otherWarnings) {
      const tokenKey = warning.tokenSymbol || warning.tokenAddress
      if (!map.has(tokenKey)) {
        map.set(tokenKey, [])
      }
      map.get(tokenKey)!.push(warning)
    }
    return map
  }, [otherWarnings])

  // Only show warnings if there are actual issues to display
  // Don't show anything during loading to prevent flash
  const hasBlockingWarnings = warnings.warnings.some((w) => w.severity === 'blocking')
  const hasAnyWarnings = warnings.warnings.length > 0
  const walletBlocked = warnings.walletStatus === 'blocked'
  const walletAllowed = warnings.walletStatus === 'allowed'

  // Don't show anything during loading (prevents flash)
  // Only show warnings after checks complete and there are actual issues
  if (warnings.isLoading) {
    return null
  }

  // After loading, only show if there are warnings or wallet is blocked
  // Show wallet "allowed" status only if there are other warnings
  if (!hasAnyWarnings && !walletBlocked) {
    return null
  }

  return (
    <Flex gap="$spacing12">
      {/* Wallet KYC status - show if determined (allowed or blocked) */}
      {showWalletStatus && shouldShowWalletStatus && (
        <>
          {warnings.walletStatus === 'allowed' && (
            <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
              <Flex backgroundColor="$statusSuccess2" p="$padding12" borderRadius="$rounded12" alignSelf="flex-start">
                <Text color="$statusSuccess" fontSize={20}>
                  ✓
                </Text>
              </Flex>
              <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                <Text color="$statusSuccess" variant="body3" fontWeight="600">
                  {t('position.whitelistRestriction.walletAllowed')}
                </Text>
              </Flex>
            </Flex>
          )}

          {warnings.walletStatus === 'blocked' && (
            <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
              <Flex backgroundColor="$statusCritical2" p="$padding12" borderRadius="$rounded12" alignSelf="flex-start">
                <AlertTriangleFilled color="$statusCritical" size="$icon.20" />
              </Flex>
              <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                <Text color="$statusCritical" variant="body3" fontWeight="600">
                  {t('position.whitelistRestriction.walletNotAuthorized')}
                </Text>
                <Text variant="body3" color="$neutral2">
                  {t('position.whitelistRestriction.walletNotAuthorizedDescription')}
                </Text>
              </Flex>
            </Flex>
          )}
        </>
      )}

      {/* Other address warnings (Quoter, Router, etc.) */}
      {showOtherWarnings && warningsByToken.size > 0 && (
        <Flex gap="$spacing8">
          {Array.from(warningsByToken.entries()).map(([tokenSymbol, tokenWarnings]) => {
            const blockingWarnings = tokenWarnings.filter((w) => w.severity === 'blocking')
            const nonBlockingWarnings = tokenWarnings.filter((w) => w.severity === 'warning')

            return (
              <Flex key={tokenSymbol} gap="$spacing8">
                {blockingWarnings.length > 0 && (
                  <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
                    <Flex
                      backgroundColor="$statusCritical2"
                      p="$padding12"
                      borderRadius="$rounded12"
                      alignSelf="flex-start"
                    >
                      <AlertTriangleFilled color="$statusCritical" size="$icon.20" />
                    </Flex>
                    <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                      <Text color="$statusCritical" variant="body3" fontWeight="600">
                        {t('position.whitelistRestriction.title')}
                      </Text>
                      <Text variant="body3" color="$neutral2">
                        {t('position.whitelistRestriction.addressesNotWhitelisted', {
                          tokenSymbol,
                        })}
                      </Text>
                      <Flex gap="$gap2" mt="$spacing4">
                        {blockingWarnings.map((warning, idx) => (
                          <ClickableAddress key={idx} label={warning.subjectLabel} address={warning.address} />
                        ))}
                      </Flex>
                      <Text variant="body3" color="$neutral2" mt="$spacing4">
                        {t('position.whitelistRestriction.contactAdmin')}
                      </Text>
                    </Flex>
                  </Flex>
                )}

                {nonBlockingWarnings.length > 0 && (
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
                        {t('position.whitelistRestriction.cannotVerifyTitle')}
                      </Text>
                      <Text variant="body3" color="$neutral2">
                        {t('position.whitelistRestriction.cannotVerifyMessage', {
                          tokenSymbol,
                        })}
                      </Text>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            )
          })}
        </Flex>
      )}
    </Flex>
  )
}

/**
 * Component for displaying a clickable address that can be copied
 */
function ClickableAddress({ label, address }: { label: string; address: string }): JSX.Element {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await setClipboard(address)
      setIsCopied(true)
    } catch (error) {
      console.error('Failed to copy address:', error)
    }
  }

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [isCopied])

  return (
    <Flex row gap="$gap4" alignItems="center" flexWrap="wrap">
      <Text variant="body3" color="$neutral2">
        • {label}:
      </Text>
      <TouchableArea onPress={handleCopy}>
        <Text
          variant="body3"
          color={isCopied ? '$statusSuccess' : '$neutral1'}
          style={{ textDecorationLine: 'underline', cursor: 'pointer' }}
        >
          {address}
          {isCopied ? ' ✓ Copied!' : ''}
        </Text>
      </TouchableArea>
    </Flex>
  )
}
