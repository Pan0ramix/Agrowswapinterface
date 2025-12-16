import { UNIVERSAL_ROUTER_ADDRESS, UniversalRouterVersion } from '@uniswap/universal-router-sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

// Override Universal Router address for Agroswap Base Sepolia deployment
const UNIVERSAL_ROUTER_OVERRIDES: Partial<Record<number, string>> = {
  [UniverseChainId.BaseSepolia]: '0xF2405e35650268a08a9c12d3Ab7Fc0B82EBa5318',
}

export function getUniversalRouterAddress(version: UniversalRouterVersion, chainId: UniverseChainId | number): string {
  return UNIVERSAL_ROUTER_OVERRIDES[chainId] ?? UNIVERSAL_ROUTER_ADDRESS(version, chainId)
}
