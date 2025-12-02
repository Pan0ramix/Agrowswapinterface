/**
 * Agroswap contract addresses for Base Sepolia (chainId 84532)
 * These override the default Uniswap SDK addresses for Base Sepolia
 */
import {
  MULTICALL_ADDRESSES,
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  QUOTER_ADDRESSES,
  SWAP_ROUTER_02_ADDRESSES,
  V3_CORE_FACTORY_ADDRESSES,
} from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

// Agroswap contract addresses on Base Sepolia
const BASE_SEPOLIA_V3_CORE_FACTORY_ADDRESS = '0xd8B483e9D01AEF316D0b6971f55d32614a280CE3'
// Multicall3 address for Base Sepolia (same as Ethereum's Multicall3)
// This is backward compatible with Multicall2 and uses tryBlockAndAggregate
// Address: 0xcA11bde05977b3631167028862bE2a173976CA11
const BASE_SEPOLIA_MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const BASE_SEPOLIA_QUOTER_V2_ADDRESS = '0x8A1b1Da3C114FEc711F17EF49A2CC5Cc97dc76D6'
const BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER_ADDRESS = '0xD2AF9906D955bcbdD3CD7411fd8a7E22574ce497'
const BASE_SEPOLIA_SWAP_ROUTER_ADDRESS = '0xfc92663ccf3c1fe47eE72057df1f1D00fbdCD9C6'

/**
 * Override V3 Core Factory addresses with Agroswap addresses
 */
export const AGROSWAP_V3_CORE_FACTORY_ADDRESSES = {
  ...V3_CORE_FACTORY_ADDRESSES,
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_V3_CORE_FACTORY_ADDRESS,
}

/**
 * Override Multicall addresses with Agroswap addresses
 */
export const AGROSWAP_MULTICALL_ADDRESSES = {
  ...MULTICALL_ADDRESSES,
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_MULTICALL_ADDRESS,
}

/**
 * Override Quoter addresses with Agroswap addresses
 * Note: SDK exports QUOTER_ADDRESSES (not QUOTER_V2_ADDRESSES)
 */
export const AGROSWAP_QUOTER_ADDRESSES = {
  ...QUOTER_ADDRESSES,
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_QUOTER_V2_ADDRESS,
}

/**
 * Override Nonfungible Position Manager addresses with Agroswap addresses
 */
export const AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES = {
  ...NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  [UniverseChainId.BaseSepolia]: BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
}

/**
 * Override Swap Router addresses with Agroswap addresses
 * SWAP_ROUTER_02_ADDRESSES is a function, so we need to wrap it
 */
export function getAgroswapSwapRouterAddress(chainId: number): string {
  if (chainId === UniverseChainId.BaseSepolia) {
    return BASE_SEPOLIA_SWAP_ROUTER_ADDRESS
  }
  return SWAP_ROUTER_02_ADDRESSES(chainId)
}
