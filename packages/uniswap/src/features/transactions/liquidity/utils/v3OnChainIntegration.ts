/**
 * V3 On-Chain Integration Utilities
 *
 * Helper functions to integrate on-chain V3 LP operations into existing UI flows.
 */

import { FeeAmount } from '@uniswap/v3-sdk'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'

/**
 * Determines if we should use on-chain V3 operations instead of Trading API
 * Uses the same chain check as the on-chain router for consistency
 *
 * Enabled chains: [84532 (Base Sepolia), 8453 (Base), 137 (Polygon)]
 */
export function shouldUseV3OnChainLp({
  chainId,
  protocolVersion,
  featureFlagEnabled = true, // Default to true
}: {
  chainId?: number
  protocolVersion?: string
  featureFlagEnabled?: boolean
}): boolean {
  // Check feature flag (if implemented)
  if (!featureFlagEnabled) {
    return false
  }

  // Use the same chain check as on-chain router
  const chainIdNum = typeof chainId === 'number' ? chainId : (chainId as any)
  if (!chainIdNum || !isOnChainRouterEnabled(chainIdNum)) {
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
    sqrtPriceX96?: string
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
    sqrtRatioX96: txPayload.sqrtPriceX96,
  }
}

/**
 * Helper to convert on-chain decrease liquidity transaction payload to DecreaseLPPositionResponse format
 * This allows on-chain payloads to work with existing UI components
 */
export function convertOnChainTxToDecreaseLpResponse(
  txPayload: {
    to: string
    data: string
    value: string
  },
  chainId: EVMUniverseChainId,
  sqrtRatioX96?: string,
): {
  decrease: {
    to: string
    data: string
    value: string
    chainId: number
  }
  sqrtRatioX96?: string
} {
  return {
    decrease: {
      to: txPayload.to,
      data: txPayload.data,
      value: txPayload.value,
      chainId,
    },
    sqrtRatioX96,
  }
}
