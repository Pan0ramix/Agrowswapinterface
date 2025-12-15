import { PoolSortFields } from 'appGraphql/data/pools/useTopPools'
import { OrderDirection } from 'appGraphql/data/util'
import { ExploreStatsResponse, PoolStats, ExplorerStats } from '@uniswap/client-explore/dist/uniswap/explore/v1/service_pb'
import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { ALL_NETWORKS_ARG } from '@universe/api'
import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { ExternalArrowLink } from 'components/Liquidity/ExternalArrowLink'
import { PositionInfo } from 'components/Liquidity/types'
import { useAccount } from 'hooks/useAccount'
import { TopPoolsSection } from 'pages/Positions/TopPoolsSection'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import { useTopPools } from 'state/explore/topPools'
import { Flex, useMedia } from 'ui/src'
import { useExploreStatsQuery } from 'uniswap/src/data/rest/exploreStats'
import { useAgroswapPoolsQuery } from 'uniswap/src/data/rest/agroswapPools'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { toGraphQLChain } from 'uniswap/src/features/chains/utils'
import { NATIVE_CHAIN_ID } from 'constants/tokens'

const MAX_BOOSTED_POOLS = 3

/**
 * Extract unique pools from user positions and convert to ExploreStatsResponse format
 * Used as fallback when factory query returns empty
 */
function extractPoolsFromPositions(
  positions: PositionInfo[],
  chainId: UniverseChainId | null,
): ExploreStatsResponse | undefined {
  if (!positions || positions.length === 0 || !chainId) {
    return undefined
  }

  // Get unique pools by poolId, aggregating liquidity from all positions in the same pool
  const poolMap = new Map<string, { position: PositionInfo; totalToken0: number; totalToken1: number }>()
  
  positions.forEach((position) => {
    if (position.chainId === chainId && position.poolId && position.version === ProtocolVersion.V3) {
      const existing = poolMap.get(position.poolId)
      if (existing) {
        // Aggregate liquidity from multiple positions in the same pool
        const token0Value = position.currency0Amount ? parseFloat(position.currency0Amount.toExact()) : 0
        const token1Value = position.currency1Amount ? parseFloat(position.currency1Amount.toExact()) : 0
        existing.totalToken0 += token0Value
        existing.totalToken1 += token1Value
      } else {
        const token0Value = position.currency0Amount ? parseFloat(position.currency0Amount.toExact()) : 0
        const token1Value = position.currency1Amount ? parseFloat(position.currency1Amount.toExact()) : 0
        poolMap.set(position.poolId, {
          position,
          totalToken0: token0Value,
          totalToken1: token1Value,
        })
      }
    }
  })

  if (poolMap.size === 0) {
    return undefined
  }

  // Convert aggregated pools to PoolStats
  const graphQLChain = toGraphQLChain(chainId)
  const poolStats: PoolStats[] = Array.from(poolMap.values()).map(({ position, totalToken0, totalToken1 }) => {
    // Use a simple estimate: sum of token amounts (will be sorted by order found if TVL is 0)
    // In a real scenario, you'd calculate actual USD value using price feeds
    const estimatedTvlUSD = totalToken0 + totalToken1

    // Handle native tokens correctly - use NATIVE_CHAIN_ID for native, actual address for tokens
    const token0Address = position.currency0Amount?.currency.isToken
      ? position.currency0Amount.currency.address
      : NATIVE_CHAIN_ID
    const token1Address = position.currency1Amount?.currency.isToken
      ? position.currency1Amount.currency.address
      : NATIVE_CHAIN_ID

    const poolStat = new PoolStats({
      id: position.poolId,
      chain: graphQLChain,
      feeTier: position.feeTier?.feeAmount,
      protocolVersion: 'v3', // V3 pools - lowercase 'v' for proper display
      token0: {
        chain: graphQLChain,
        address: token0Address,
        symbol: position.currency0Amount?.currency.symbol || '',
        name: position.currency0Amount?.currency.name || '',
        decimals: position.currency0Amount?.currency.decimals || 18,
      },
      token1: {
        chain: graphQLChain,
        address: token1Address,
        symbol: position.currency1Amount?.currency.symbol || '',
        name: position.currency1Amount?.currency.name || '',
        decimals: position.currency1Amount?.currency.decimals || 18,
      },
      totalLiquidity: {
        currency: 'USD',
        value: estimatedTvlUSD,
      },
      volume1Day: {
        currency: 'USD',
        value: 0, // Volume not available from positions
      },
    })

    return poolStat
  })

  const stats = new ExplorerStats({
    poolStats,
    poolStatsV3: poolStats,
  })

  return new ExploreStatsResponse({
    stats,
  })
}

export function TopPools({ chainId, positions }: { chainId: UniverseChainId | null; positions?: PositionInfo[] }) {
  const account = useAccount()
  const { t } = useTranslation()
  const isLPIncentivesEnabled = useFeatureFlag(FeatureFlags.LpIncentives)
  const media = useMedia()
  const isBelowXlScreen = !media.xl

  // Use Agroswap pools for Base Sepolia
  // When chainId is null, default to Base Sepolia for Agroswap
  const effectiveChainId = chainId ?? UniverseChainId.BaseSepolia
  const isBaseSepolia = effectiveChainId === UniverseChainId.BaseSepolia
  
  const agroswapQuery = useAgroswapPoolsQuery({ chainId: effectiveChainId, enabled: isBaseSepolia })
  const uniswapQuery = useExploreStatsQuery<ExploreStatsResponse>({
    input: { chainId: chainId ? chainId.toString() : ALL_NETWORKS_ARG },
    enabled: !isBaseSepolia,
  })

  // Extract pools from user positions as fallback
  const positionsFallback = useMemo(() => {
    if (isBaseSepolia && positions && positions.length > 0) {
      return extractPoolsFromPositions(positions, effectiveChainId)
    }
    return undefined
  }, [isBaseSepolia, positions, effectiveChainId])

  // Always prefer Agroswap data when available for Base Sepolia, fallback to positions, then Uniswap
  const exploreStatsData = useMemo(() => {
    if (isBaseSepolia) {
      // Priority: Agroswap query > Positions fallback > Uniswap
      if (agroswapQuery.data && agroswapQuery.data.stats?.poolStats && agroswapQuery.data.stats.poolStats.length > 0) {
        return agroswapQuery.data
      }
      if (positionsFallback) {
        return positionsFallback
      }
    }
    return uniswapQuery.data
  }, [isBaseSepolia, agroswapQuery.data, positionsFallback, uniswapQuery.data])

  const exploreStatsLoading = isBaseSepolia ? agroswapQuery.isLoading : uniswapQuery.isLoading
  const exploreStatsError = isBaseSepolia ? agroswapQuery.error : uniswapQuery.error

  const { topPools, topBoostedPools } = useTopPools({
    topPoolData: { data: exploreStatsData, isLoading: exploreStatsLoading, isError: !!exploreStatsError },
    sortState: { sortDirection: OrderDirection.Desc, sortBy: PoolSortFields.TVL },
  })

  // Debug logging for Base Sepolia
  if (isBaseSepolia && process.env.NODE_ENV !== 'production') {
    console.log('[TopPools] Base Sepolia pools:', {
      hasData: !!exploreStatsData,
      stats: exploreStatsData?.stats,
      poolStatsCount: exploreStatsData?.stats?.poolStats?.length,
      poolStatsV3Count: exploreStatsData?.stats?.poolStatsV3?.length,
      topPoolsCount: topPools?.length,
      isLoading: exploreStatsLoading,
      error: exploreStatsError,
    })
  }

  // Always show rewards section if LP incentives are enabled and user is connected
  const shouldShowRewardsSection = isLPIncentivesEnabled && Boolean(account.address)
  const hasBoostedPools = topBoostedPools && topBoostedPools.length > 0
  const displayTopPools = topPools && topPools.length > 0

  // Show pools on all screen sizes (removed screen size restriction)
  // Always show the section, even if loading or empty (will show loading state)
  return (
    <Flex gap={48}>
      {/* Always show Pools with rewards section if LP incentives enabled */}
      {shouldShowRewardsSection && (
        <Flex gap="$gap20">
          <TopPoolsSection
            title={t('pool.top.rewards')}
            pools={hasBoostedPools ? topBoostedPools.slice(0, MAX_BOOSTED_POOLS) : []}
            isLoading={exploreStatsLoading}
            showEmptyState={true}
          />
          {hasBoostedPools && (
            <ExternalArrowLink href="/explore/pools" openInNewTab={false}>
              {t('explore.more.unichain')}
            </ExternalArrowLink>
          )}
        </Flex>
      )}
      {/* Always show Top Pools section - will show loading state if no pools yet */}
      <Flex gap="$gap20">
        <TopPoolsSection 
          title={t('pool.top.tvl')} 
          pools={topPools || []} 
          isLoading={exploreStatsLoading}
          showEmptyState={true}
        />
        {displayTopPools && (
          <ExternalArrowLink href="/explore/pools" openInNewTab={false}>
            {t('explore.more.pools')}
          </ExternalArrowLink>
        )}
      </Flex>
    </Flex>
  )
}
