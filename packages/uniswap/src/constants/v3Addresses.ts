/**
 * Override V3 contract addresses for custom deployments
 * This file extends the addresses from @uniswap/sdk-core with custom deployments
 */
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES, V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

// Custom contract addresses for Base Sepolia (Chain ID: 84532)
const BASE_SEPOLIA_V3_FACTORY = '0xd8B483e9D01AEF316D0b6971f55d32614a280CE3'
const BASE_SEPOLIA_POSITION_MANAGER = '0xD2AF9906D955bcbdD3CD7411fd8a7E22574ce497'
const BASE_SEPOLIA_SWAP_ROUTER = '0xfc92663ccf3c1fe47eE72057df1f1D00fbdCD9C6'
const BASE_SEPOLIA_QUOTER_V2 = '0x8A1b1Da3C114FEc711F17EF49A2CC5Cc97dc76D6'
const BASE_SEPOLIA_WETH = '0xE6acF4D03Fb173e590645Cc2432F2943c438A57A'

/**
 * Extended V3 Factory addresses with custom deployments
 */
export const V3_CORE_FACTORY_ADDRESSES_OVERRIDE: Record<number, string> = {
  ...V3_CORE_FACTORY_ADDRESSES,
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_V3_FACTORY,
}

/**
 * Extended Position Manager addresses with custom deployments
 */
export const NONFUNGIBLE_POSITION_MANAGER_ADDRESSES_OVERRIDE: Record<number, string> = {
  ...NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_POSITION_MANAGER,
}

/**
 * Extended Multicall addresses with custom deployments
 * Base Sepolia multicall: 0xd867e273eAbD6c853fCd0Ca0bFB6a3aE6491d2C1
 */
export const MULTICALL_ADDRESSES_OVERRIDE: Record<number, string> = {
  [UniverseChainId.BaseSepolia]: '0xd867e273eAbD6c853fCd0Ca0bFB6a3aE6491d2C1',
}

/**
 * Swap Router addresses for custom deployments
 */
export const SWAP_ROUTER_ADDRESSES: Record<number, string | undefined> = {
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_SWAP_ROUTER,
}

/**
 * Quoter V2 addresses for custom deployments
 */
export const QUOTER_V2_ADDRESSES: Record<number, string | undefined> = {
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_QUOTER_V2,
}

/**
 * WETH addresses for custom deployments
 */
export const WETH_ADDRESSES: Record<number, string | undefined> = {
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_WETH,
}

/**
 * Get V3 Factory address with overrides
 */
export function getV3FactoryAddress(chainId: UniverseChainId | number): string | undefined {
  const chainIdNum = typeof chainId === 'number' ? chainId : chainId
  return V3_CORE_FACTORY_ADDRESSES_OVERRIDE[chainIdNum]
}

/**
 * Get Position Manager address with overrides
 */
export function getPositionManagerAddress(chainId: UniverseChainId | number): string | undefined {
  const chainIdNum = typeof chainId === 'number' ? chainId : chainId
  return NONFUNGIBLE_POSITION_MANAGER_ADDRESSES_OVERRIDE[chainIdNum]
}

/**
 * Get Swap Router address
 */
export function getSwapRouterAddress(chainId: UniverseChainId | number): string | undefined {
  const chainIdNum = typeof chainId === 'number' ? chainId : chainId
  return SWAP_ROUTER_ADDRESSES[chainIdNum]
}

/**
 * Get Quoter V2 address
 */
export function getQuoterV2Address(chainId: UniverseChainId | number): string | undefined {
  const chainIdNum = typeof chainId === 'number' ? chainId : chainId
  return QUOTER_V2_ADDRESSES[chainIdNum]
}

/**
 * Get WETH address
 */
export function getWETHAddress(chainId: UniverseChainId | number): string | undefined {
  const chainIdNum = typeof chainId === 'number' ? chainId : chainId
  return WETH_ADDRESSES[chainIdNum]
}
