/**
 * V3 On-Chain Integration Utilities
 * 
 * Helper functions to integrate on-chain V3 LP operations into existing UI flows.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { EVMUniverseChainId, UniverseChainId } from 'uniswap/src/features/chains/types'

// Base Sepolia chain ID constant
const BASE_SEPOLIA_CHAIN_ID = 84532

/**
 * Determines if we should use on-chain V3 operations instead of Trading API
 * For now, only for Base Sepolia V3 positions
 * 
 * TODO: Add feature flag support:
 * ```typescript
 * import { useFeatureFlag } from '@universe/gating'
 * const v3OnChainEnabled = useFeatureFlag(FeatureFlags.V3OnChainEnabled)
 * if (!v3OnChainEnabled) return false
 * ```
 */
export function shouldUseV3OnChainLp({
  chainId,
  protocolVersion,
  featureFlagEnabled = true, // Default to true for Base Sepolia
}: {
  chainId?: number
  protocolVersion?: string
  featureFlagEnabled?: boolean
}): boolean {
  // Check feature flag (if implemented)
  if (!featureFlagEnabled) {
    return false
  }

  // Only for Base Sepolia (84532) for now
  // TODO: Expand to other chains as needed
  // Handle both numeric and enum values
  const chainIdNum = typeof chainId === 'number' ? chainId : (chainId as any)
  if (chainIdNum !== BASE_SEPOLIA_CHAIN_ID && chainIdNum !== UniverseChainId.BaseSepolia) {
    return false
  }

  // Only for V3 protocol
  if (protocolVersion !== 'V3' && protocolVersion !== 'v3') {
    return false
  }

  return true
}

/**
 * Converts fee amount number to FeeAmount enum
 */
export function convertFeeToFeeAmount(fee?: number | { feeAmount?: number }): FeeAmount | undefined {
  if (!fee) {
    return undefined
  }

  const feeValue = typeof fee === 'number' ? fee : fee.feeAmount
  if (!feeValue) {
    return undefined
  }

  // Map common fee tiers
  switch (feeValue) {
    case 100:
      return FeeAmount.LOWEST
    case 500:
      return FeeAmount.LOW
    case 3000:
      return FeeAmount.MEDIUM
    case 10000:
      return FeeAmount.HIGH
    default:
      // Try to match closest
      if (feeValue <= 100) {
        return FeeAmount.LOWEST
      }
      if (feeValue <= 500) {
        return FeeAmount.LOW
      }
      if (feeValue <= 3000) {
        return FeeAmount.MEDIUM
      }
      return FeeAmount.HIGH
  }
}

/**
 * Helper to convert on-chain LP transaction payload to CreateLPPositionResponse format
 * This allows on-chain payloads to work with existing UI components
 */
export function convertOnChainTxToCreateLpResponse(
  txPayload: {
    to: string
    data: string
    value: string
  },
  chainId: EVMUniverseChainId,
): {
  create: {
    to: string
    data: string
    value: string
    chainId: number
  }
  dependentAmount?: string
  sqrtRatioX96?: string
} {
  return {
    create: {
      to: txPayload.to,
      data: txPayload.data,
      value: txPayload.value,
      chainId,
    },
  }
}

