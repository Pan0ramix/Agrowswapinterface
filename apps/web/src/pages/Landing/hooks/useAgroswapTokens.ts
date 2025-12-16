import { GraphQLApi } from '@universe/api'
import { NATIVE_CHAIN_ID } from 'constants/tokens'
import { InteractiveToken } from 'pages/Landing/assets/approvedTokens'
import { useMemo } from 'react'
import { useAgroswapPoolsQuery } from 'uniswap/src/data/rest/agroswapPools'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { fromGraphQLChain } from 'uniswap/src/features/chains/utils'

// Generate a color from token address
function generateColorFromAddress(address: string): string {
  // Simple hash-based color generation
  let hash = 0
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash % 360)
  return `hsl(${hue}, 70%, 50%)`
}

// Get logo URL for a token
function getTokenLogoUrl(address: string, chain: GraphQLApi.Chain): string {
  // Handle native tokens
  if (address === NATIVE_CHAIN_ID) {
    const chainId = fromGraphQLChain(chain)
    if (chainId) {
      const chainInfo = getChainInfo(chainId)
      // chainInfo.nativeCurrency.logo is an ImageSourcePropType, we need to extract URL if it's a string
      const nativeLogo = chainInfo.nativeCurrency.logo
      if (typeof nativeLogo === 'string') {
        return nativeLogo
      }
      // If it's an object (like require()), use default
    }
    return 'https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/ethereum/assets/0x0000000000000000000000000000000000000000/logo.png'
  }

  // For other tokens, use Uniswap assets repo pattern
  // This is a fallback - actual logos should come from GraphQL token.project.logoUrl
  const chainName = chain.toLowerCase()
  return `https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/${chainName}/assets/${address}/logo.png`
}

export function useAgroswapTokens(): InteractiveToken[] {
  const { defaultChainId } = useEnabledChains()
  // Always use Base Sepolia for Agroswap pools (the query only works for Base Sepolia anyway)
  const chainId = UniverseChainId.BaseSepolia

  const {
    data: poolsData,
    isLoading,
    error,
    isFetching,
  } = useAgroswapPoolsQuery({
    chainId,
    enabled: true,
  })

  // Extract unique tokens from pools
  const tokens = useMemo(() => {
    // Only return empty if we're still loading and haven't gotten data yet
    // If we have data (even if empty), use it
    if (isLoading && !poolsData) {
      return []
    }

    // If there's an error or no data, return empty (fallback will be used in TokenCloud)
    if (!poolsData?.stats?.poolStats || poolsData.stats.poolStats.length === 0) {
      return []
    }

    const tokenMap = new Map<string, InteractiveToken>()
    const graphQLChain = poolsData.stats.poolStats[0]?.chain

    if (!graphQLChain) {
      return []
    }

    // Process each pool to extract token0 and token1
    for (const pool of poolsData.stats.poolStats) {
      // Add token0
      if (pool.token0) {
        const token0Address = pool.token0.address || NATIVE_CHAIN_ID
        const token0Key = `${pool.token0.chain}-${token0Address.toLowerCase()}`
        if (!tokenMap.has(token0Key)) {
          tokenMap.set(token0Key, {
            name: pool.token0.name || pool.token0.symbol || 'Unknown',
            symbol: pool.token0.symbol || 'UNK',
            address: token0Address,
            chain: pool.token0.chain,
            color: generateColorFromAddress(token0Address),
            logoUrl: getTokenLogoUrl(token0Address, pool.token0.chain),
          })
        }
      }

      // Add token1
      if (pool.token1) {
        const token1Address = pool.token1.address || NATIVE_CHAIN_ID
        const token1Key = `${pool.token1.chain}-${token1Address.toLowerCase()}`
        if (!tokenMap.has(token1Key)) {
          tokenMap.set(token1Key, {
            name: pool.token1.name || pool.token1.symbol || 'Unknown',
            symbol: pool.token1.symbol || 'UNK',
            address: token1Address,
            chain: pool.token1.chain,
            color: generateColorFromAddress(token1Address),
            logoUrl: getTokenLogoUrl(token1Address, pool.token1.chain),
          })
        }
      }
    }

    const extractedTokens = Array.from(tokenMap.values())
    return extractedTokens
  }, [poolsData, isLoading, error])

  return tokens
}
