import AppJsonRpcProvider from 'rpc/AppJsonRpcProvider'
import ConfiguredJsonRpcProvider from 'rpc/ConfiguredJsonRpcProvider'
import { ALL_EVM_CHAIN_IDS, getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { EVMUniverseChainId, RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'

function isValidRpcUrl(url: string): boolean {
  if (!url) {
    return false
  }
  if (url.includes('undefined')) {
    return false
  }
  // Filter out provider endpoints missing an API key (e.g., trailing /v2/ or /v3/)
  if (url.endsWith('/v2/') || url.endsWith('/v3/') || url.endsWith('/v2') || url.endsWith('/v3')) {
    return false
  }
  return true
}

function getAppProvider(chainId: UniverseChainId): AppJsonRpcProvider | null {
  const info = getChainInfo(chainId)
  // Prefer interface RPCs, but fall back to default/public/fallback if interface is not configured
  const urls = [
    ...(info.rpcUrls.interface.http ?? []),
    ...(info.rpcUrls[RPCType.Default].http ?? []),
    ...(info.rpcUrls[RPCType.Public]?.http ?? []),
    ...(info.rpcUrls[RPCType.Fallback]?.http ?? []),
  ]
    // Drop any empty/undefined URLs (e.g., infura key missing)
    .filter(isValidRpcUrl)

  if (!urls.length) {
    return null
  }

  return new AppJsonRpcProvider(
    urls.map((url) => new ConfiguredJsonRpcProvider({ url, networkish: { chainId, name: info.interfaceName } })),
  )
}

/** These are the only JsonRpcProviders used directly by the interface. */
export const RPC_PROVIDERS = Object.fromEntries(
  ALL_EVM_CHAIN_IDS.map((chain) => [chain, getAppProvider(chain)]).filter(([, provider]) => provider !== null),
) as Record<EVMUniverseChainId, AppJsonRpcProvider>
