import { ALL_NETWORKS_ARG, CustomRankingType } from '@universe/api'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tokenRankingsStatToCurrencyInfo, useTokenRankingsQuery } from 'uniswap/src/data/rest/tokenRankings'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { Token } from '@uniswap/sdk-core'

export function useTrendingTokensCurrencyInfos(
  chainFilter: Maybe<UniverseChainId>,
  skip?: boolean,
  _disablePortfolio?: boolean,
): {
  data: CurrencyInfo[] | undefined
  error: Error | undefined
  refetch: () => void
  loading: boolean
} {
  const baseSepoliaListQuery = useQuery({
    queryKey: ['tokenlist-base-sepolia'],
    enabled: chainFilter === UniverseChainId.BaseSepolia && !skip,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CurrencyInfo[]> => {
      const url =
        typeof window !== 'undefined'
          ? `${window.location.origin}/agroswap-base-sepolia.tokenlist.json`
          : '/agroswap-base-sepolia.tokenlist.json'
      const res = await fetch(url, { credentials: 'omit' })
      if (!res.ok) {
        throw new Error(`Failed to fetch Base Sepolia token list (${res.status})`)
      }
      const json = await res.json()
      const tokens = (json?.tokens ?? [])
        .filter((t: any) => t.chainId === UniverseChainId.BaseSepolia)
        .map(
          (t: any) =>
            new Token(UniverseChainId.BaseSepolia, t.address, t.decimals, t.symbol ?? 'UNKNOWN', t.name ?? 'Unknown'),
        )
      return tokens.map((token: Token) =>
        buildCurrencyInfo({
          currency: token,
          currencyId: currencyId(token),
          logoUrl: null,
        }),
      )
    },
  })

  const { data, isLoading, error, refetch, isFetching } = useTokenRankingsQuery(
    {
      chainId: chainFilter?.toString() ?? ALL_NETWORKS_ARG,
    },
    !skip,
  )

  // Use local Base Sepolia list when applicable; otherwise use rankings
  if (chainFilter === UniverseChainId.BaseSepolia) {
    return {
      data: baseSepoliaListQuery.data,
      error: baseSepoliaListQuery.error ?? undefined,
      refetch: baseSepoliaListQuery.refetch,
      loading: baseSepoliaListQuery.isLoading || baseSepoliaListQuery.isFetching,
    }
  }

  const trendingTokens = data?.tokenRankings[CustomRankingType.Trending]?.tokens
  const formattedTokens = useMemo(
    () => trendingTokens?.map(tokenRankingsStatToCurrencyInfo).filter((t): t is CurrencyInfo => Boolean(t)),
    [trendingTokens],
  )

  return { data: formattedTokens, loading: isLoading || isFetching, error: error ?? undefined, refetch }
}
