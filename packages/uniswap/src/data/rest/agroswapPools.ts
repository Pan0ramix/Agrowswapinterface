import { ConnectError } from '@connectrpc/connect'
import { UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  ExplorerStats,
  ExploreStatsResponse,
  PoolStats,
} from '@uniswap/client-explore/dist/uniswap/explore/v1/service_pb'
import { AGROSWAP_V3_CORE_FACTORY_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'
import { toGraphQLChain } from 'uniswap/src/features/chains/utils'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { OnChainPoolData, queryFactoryPools, queryPoolsFromSubgraph } from 'uniswap/src/data/rest/agroswapPoolsOnChain'

/**
 * Configuration flag to switch between on-chain and subgraph queries
 * Set to true when Goldsky subgraph is ready
 */
const USE_SUBGRAPH = false

/**
 * Fetches pools from Agroswap factory contracts for Base Sepolia
 * Queries on-chain from factory contract. Can be switched to subgraph (Goldsky) later.
 */
export function useAgroswapPoolsQuery({
  chainId,
  enabled = true,
}: {
  chainId: UniverseChainId | null
  enabled?: boolean
}): UseQueryResult<ExploreStatsResponse, ConnectError> {
  // Handle null chainId by defaulting to Base Sepolia
  const effectiveChainId = chainId ?? UniverseChainId.BaseSepolia
  const isBaseSepolia = effectiveChainId === UniverseChainId.BaseSepolia

  return useQuery({
    queryKey: ['agroswap-pools', effectiveChainId, 'onchain-v0.0.3'],
    enabled: isBaseSepolia && enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes (on-chain queries are slower)
    queryFn: async (): Promise<ExploreStatsResponse> => {
      // Use effectiveChainId (should never be null at this point due to enabled check)
      const queryChainId = effectiveChainId
      if (!queryChainId) {
        throw new Error('Chain ID is required')
      }

      const factoryAddress =
        AGROSWAP_V3_CORE_FACTORY_ADDRESSES[queryChainId as keyof typeof AGROSWAP_V3_CORE_FACTORY_ADDRESSES]
      if (!factoryAddress) {
        throw new Error(`Factory address not found for chain ${queryChainId}`)
      }

      // Create viem client for on-chain queries
      const publicClient = createViemClient({
        chainId: queryChainId,
        rpcType: RPCType.Public,
      })

      if (!publicClient) {
        throw new Error(`Failed to create public client for chain ${queryChainId}`)
      }

      // Query pools - switch between on-chain and subgraph based on config
      let pools: OnChainPoolData[]
      if (USE_SUBGRAPH) {
        // TODO: Implement Goldsky subgraph integration
        pools = await queryPoolsFromSubgraph(queryChainId)
      } else {
        // Query on-chain from factory contract
        pools = await queryFactoryPools(publicClient, factoryAddress as `0x${string}`, queryChainId)
      }

      // Convert on-chain pool data to ExploreStatsResponse format
      const graphQLChain = toGraphQLChain(queryChainId)
      const poolStats: PoolStats[] = pools.map((pool) => {
        // Create PoolStats object
        const poolStat = new PoolStats({
          id: pool.poolAddress,
          chain: graphQLChain,
          feeTier: pool.feeTier,
          protocolVersion: 'v3', // V3 pools - lowercase 'v' for proper display
          token0: {
            chain: graphQLChain,
            address: pool.token0.address,
            symbol: pool.token0.symbol,
            name: pool.token0.name,
            decimals: pool.token0.decimals,
          },
          token1: {
            chain: graphQLChain,
            address: pool.token1.address,
            symbol: pool.token1.symbol,
            name: pool.token1.name,
            decimals: pool.token1.decimals,
          },
          totalLiquidity: {
            currency: 'USD',
            value: pool.tvlUSD,
          },
          volume1Day: {
            currency: 'USD',
            value: pool.volume24hUSD,
          },
        })

        return poolStat
      })

      // Create ExplorerStats with poolStats and poolStatsV3 (for V3 protocol filtering)
      const stats = new ExplorerStats({
        poolStats,
        poolStatsV3: poolStats, // Also populate V3-specific array for protocol filtering
      })

      // Create ExploreStatsResponse
      const response = new ExploreStatsResponse({
        stats,
      })

      return response
    },
  }) as UseQueryResult<ExploreStatsResponse, ConnectError>
}
