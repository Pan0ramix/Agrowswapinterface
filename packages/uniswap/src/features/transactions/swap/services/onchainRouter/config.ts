/**
 * On-Chain Router Configuration
 * 
 * Single source of truth for on-chain router enabled chains.
 * All other files should import from here instead of duplicating the array.
 */

/**
 * Chain IDs where the on-chain router is enabled
 * - 84532: Base Sepolia (testnet)
 * - 8453: Base (mainnet)
 * - 137: Polygon (mainnet)
 * - 80002: Polygon Amoy (testnet)
 */
export const ONCHAIN_ROUTER_ENABLED_CHAINS = [84532, 8453, 137, 80002] as const

/**
 * Chains where only the on-chain router should be used (no Trading API fallback).
 * Extend this list if additional dev chains need strict on-chain-only behavior.
 */
export const ONCHAIN_ONLY_CHAINS = [84532] as const

/**
 * Check if on-chain router is enabled for a given chain ID
 * 
 * @param chainId - Chain ID to check
 * @returns true if on-chain router is enabled for this chain
 */
export function isOnChainRouterEnabled(chainId?: number): boolean {
  return !!chainId && ONCHAIN_ROUTER_ENABLED_CHAINS.includes(chainId as any)
}

/**
 * Check if a chain must use on-chain routing exclusively.
 *
 * @param chainId - Chain ID to check
 * @returns true if the chain should never use Trading API / service providers
 */
export function isOnChainOnlyChain(chainId?: number): boolean {
  return !!chainId && ONCHAIN_ONLY_CHAINS.includes(chainId as any)
}

