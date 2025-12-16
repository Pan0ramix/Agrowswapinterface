/**
 * Trading API Enablement Check
 *
 * Trading API is completely disabled for Agroswap.
 * All swaps and liquidity operations use on-chain routing only.
 */

/**
 * Check if Trading API is enabled for a given chain ID
 *
 * @param chainId - Chain ID to check
 * @returns Always returns false - Trading API is disabled for all chains
 */
export function isTradingApiEnabled(chainId?: number): boolean {
  // Trading API is completely disabled for Agroswap
  return false
}
