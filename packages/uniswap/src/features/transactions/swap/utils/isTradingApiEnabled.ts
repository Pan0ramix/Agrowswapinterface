/**
 * Trading API Enablement Check
 * 
 * Single source of truth for whether Trading API should be used for a given chain.
 * For on-chain-only chains (e.g., Base Sepolia), Trading API is disabled.
 */

import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'

/**
 * Check if Trading API is enabled for a given chain ID
 * 
 * @param chainId - Chain ID to check
 * @returns false if chain is on-chain-only, true otherwise
 */
export function isTradingApiEnabled(chainId?: number): boolean {
  if (!chainId) {
    return true // Default to enabled if chainId is unknown
  }
  
  // On-chain-only chains should never use Trading API
  return !isOnChainOnlyChain(chainId)
}
