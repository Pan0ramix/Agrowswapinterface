/**
 * Shared hook for restricted token warnings
 *
 * This hook provides a standardized warning model that can be used across platforms.
 * It wraps useRestrictedTokenAllowlistChecks and transforms the data into a
 * platform-agnostic warning structure.
 */

import { useMemo } from 'react'
import {
  type UseRestrictedTokenAllowlistChecksParams,
  useRestrictedTokenAllowlistChecks,
} from 'uniswap/src/features/transactions/hooks/useRestrictedTokenAllowlistChecks'
import { Address } from 'viem'

export type WarningSeverity = 'blocking' | 'warning'

export type AddressType = 'wallet' | 'permit2' | 'swapRouter' | 'positionManager' | 'pool' | 'quoter'

export interface RestrictedTokenWarning {
  severity: WarningSeverity
  titleKey: string
  messageKey: string
  values: Record<string, string | number>
  addressType: AddressType
  address: Address
  tokenAddress: Address
  tokenSymbol?: string
  subjectLabel: string
}

export type WalletStatus = 'allowed' | 'blocked' | 'unknown' | 'loading'

export interface SubjectCheckResult {
  type: AddressType
  address: Address
  isAllowed: boolean | undefined // true = allowed, false = not allowed, undefined = cannot determine
  tokenAddress: Address
  tokenSymbol?: string
  error?: string
}

export interface RestrictedTokenWarnings {
  enabled: boolean
  isLoading: boolean
  restrictedTokens: Array<{ address: Address; symbol?: string }>
  walletStatus: WalletStatus
  subjects: SubjectCheckResult[]
  warnings: RestrictedTokenWarning[]
  blockingReasonCodes: string[] // Codes that indicate why swap is blocked
  isBlocked: boolean
}

interface UseRestrictedTokenWarningsParams extends Omit<UseRestrictedTokenAllowlistChecksParams, 'enabled'> {
  enabled?: boolean
}

/**
 * Shared hook that returns a standardized warning model for restricted tokens
 */
export function useRestrictedTokenWarnings({
  account,
  chainId,
  tokens,
  feeAmount,
  flow,
  poolAddresses,
  enabled = true,
}: UseRestrictedTokenWarningsParams): RestrictedTokenWarnings {
  const allowlistChecks = useRestrictedTokenAllowlistChecks({
    account,
    chainId,
    tokens,
    feeAmount,
    flow,
    poolAddresses,
    enabled,
  })

  const result = useMemo((): RestrictedTokenWarnings => {
    // Determine wallet status
    const walletChecks = allowlistChecks.debug.checked.filter((check) => check.subjectLabel === 'Wallet')
    const walletCheck = walletChecks.length > 0 ? walletChecks[0] : null

    let walletStatus: WalletStatus = 'unknown'
    if (allowlistChecks.isLoading && walletChecks.length === 0) {
      walletStatus = 'loading'
    } else if (walletCheck) {
      if (walletCheck.isAllowed === true) {
        walletStatus = 'allowed'
      } else if (walletCheck.isAllowed === false) {
        walletStatus = 'blocked'
      } else {
        walletStatus = 'unknown'
      }
    }

    // Build subjects array
    const subjects: SubjectCheckResult[] = allowlistChecks.debug.checked.map((check) => {
      let type: AddressType = 'wallet'
      if (check.subjectLabel === 'Wallet') {
        type = 'wallet'
      } else if (check.subjectLabel === 'Permit2') {
        type = 'permit2'
      } else if (check.subjectLabel === 'Swap Router') {
        type = 'swapRouter'
      } else if (check.subjectLabel === 'Position Manager') {
        type = 'positionManager'
      } else if (check.subjectLabel === 'Pool' || check.subjectLabel.startsWith('Pool ')) {
        type = 'pool'
      } else if (check.subjectLabel === 'Quoter') {
        type = 'quoter'
      }

      return {
        type,
        address: check.subjectAddress,
        isAllowed: check.isAllowed,
        tokenAddress: check.tokenAddress,
        tokenSymbol: check.tokenSymbol,
        error: check.error,
      }
    })

    // Build warnings array
    const warnings: RestrictedTokenWarning[] = []

    // Add blocking warnings
    for (const warning of allowlistChecks.blockingWarnings) {
      let addressType: AddressType = 'wallet'
      if (warning.subjectLabel === 'Wallet') {
        addressType = 'wallet'
      } else if (warning.subjectLabel === 'Permit2') {
        addressType = 'permit2'
      } else if (warning.subjectLabel === 'Swap Router') {
        addressType = 'swapRouter'
      } else if (warning.subjectLabel === 'Position Manager') {
        addressType = 'positionManager'
      } else if (warning.subjectLabel === 'Pool' || warning.subjectLabel.startsWith('Pool ')) {
        addressType = 'pool'
      } else if (warning.subjectLabel === 'Quoter') {
        addressType = 'quoter'
      }

      warnings.push({
        severity: 'blocking',
        titleKey: 'position.whitelistRestriction.title',
        messageKey: 'position.whitelistRestriction.addressNotWhitelisted',
        values: {
          subjectLabel: warning.subjectLabel,
          subjectAddress: warning.subjectAddress,
          tokenSymbol: warning.tokenSymbol || warning.tokenAddress,
        },
        addressType,
        address: warning.subjectAddress,
        tokenAddress: warning.tokenAddress,
        tokenSymbol: warning.tokenSymbol,
        subjectLabel: warning.subjectLabel,
      })
    }

    // Add non-blocking warnings
    for (const warning of allowlistChecks.nonBlockingWarnings) {
      let addressType: AddressType = 'wallet'
      if (warning.subjectLabel === 'Wallet') {
        addressType = 'wallet'
      } else if (warning.subjectLabel === 'Permit2') {
        addressType = 'permit2'
      } else if (warning.subjectLabel === 'Swap Router') {
        addressType = 'swapRouter'
      } else if (warning.subjectLabel === 'Position Manager') {
        addressType = 'positionManager'
      } else if (warning.subjectLabel === 'Pool' || warning.subjectLabel.startsWith('Pool ')) {
        addressType = 'pool'
      } else if (warning.subjectLabel === 'Quoter') {
        addressType = 'quoter'
      }

      warnings.push({
        severity: 'warning',
        titleKey: 'position.whitelistRestriction.title',
        messageKey: 'position.whitelistRestriction.cannotVerify',
        values: {
          subjectLabel: warning.subjectLabel,
          subjectAddress: warning.subjectAddress,
          tokenSymbol: warning.tokenSymbol || warning.tokenAddress,
        },
        addressType,
        address: warning.subjectAddress,
        tokenAddress: warning.tokenAddress,
        tokenSymbol: warning.tokenSymbol,
        subjectLabel: warning.subjectLabel,
      })
    }

    // Build blocking reason codes
    const blockingReasonCodes: string[] = []
    if (walletStatus === 'blocked') {
      blockingReasonCodes.push('WALLET_NOT_ALLOWED')
    }
    for (const warning of warnings) {
      if (warning.severity === 'blocking') {
        blockingReasonCodes.push(`${warning.addressType.toUpperCase()}_NOT_ALLOWED`)
      }
    }

    return {
      enabled,
      isLoading: allowlistChecks.isLoading,
      restrictedTokens: allowlistChecks.debug.restrictedTokens,
      walletStatus,
      subjects,
      warnings,
      blockingReasonCodes,
      isBlocked: allowlistChecks.isBlocked,
    }
  }, [allowlistChecks, enabled])

  return result
}
