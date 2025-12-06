/**
 * Override V3 contract addresses for custom deployments
 * This file extends the addresses from @uniswap/sdk-core with custom deployments
 */
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES, V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

// Custom contract addresses for Base Sepolia (Chain ID: 84532)
const BASE_SEPOLIA_V3_FACTORY = '0xB1285002ce1173097A7E2A1a0aCa00fBb436370d'
const BASE_SEPOLIA_POSITION_MANAGER = '0xcAB40e366603997dDAdaF30d2c774e104Ba97612'
const BASE_SEPOLIA_SWAP_ROUTER = '0xFBE90a25E523e7e668cC2Da97BED21d8FB0BDa26'
const BASE_SEPOLIA_QUOTER_V2 = '0x9B988c0B5720c3ab8a60a04e7C17126519AF64e4'
const BASE_SEPOLIA_WETH = '0x0328b69C7b94b8f5814CfDe0482Ef3bE1D4D091c'

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
 * Base Sepolia multicall: Agroswap UniswapInterfaceMulticall deployment
 */
export const MULTICALL_ADDRESSES_OVERRIDE: Record<number, string> = {
  [UniverseChainId.BaseSepolia]: '0xFc87d551FA35638da206bDe0Fb15298467Fb0dbd',
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
