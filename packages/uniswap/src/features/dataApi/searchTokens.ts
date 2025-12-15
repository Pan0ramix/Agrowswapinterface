import { useQuery } from '@tanstack/react-query'
import { SearchTokensResponse, SearchType } from '@uniswap/client-search/dist/search/v1/api_pb'
import { GqlResult } from '@universe/api'
import { Token } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { searchTokenToCurrencyInfo, useSearchTokensAndPoolsQuery } from 'uniswap/src/data/rest/searchTokensAndPools'
import { useConnectionStatus } from 'uniswap/src/features/accounts/store/hooks'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { NUMBER_OF_RESULTS_LONG } from 'uniswap/src/features/search/SearchModal/constants'
import { isWSOL } from 'uniswap/src/utils/isWSOL'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { useEvent } from 'utilities/src/react/hooks'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'

export function useSearchTokens({
  searchQuery,
  chainFilter,
  skip,
  size = NUMBER_OF_RESULTS_LONG,
  hideWSOL = false,
}: {
  searchQuery: string | null
  chainFilter: UniverseChainId | null
  skip: boolean
  size?: number
  hideWSOL?: boolean
}): GqlResult<CurrencyInfo[]> {
  const { chains: enabledChainIds } = useEnabledChains()

  const isSvmConnected = useConnectionStatus(Platform.SVM).isConnected

  // Base Sepolia local token list (from public file) to avoid CORS/REST failures
  const baseSepoliaListQuery = useQuery({
    // Include version in query key to invalidate cache when token list is updated
    queryKey: ['tokenlist-base-sepolia', 'v0.0.4'],
    enabled: chainFilter === UniverseChainId.BaseSepolia && !skip,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CurrencyInfo[]> => {
      const url =
        typeof window !== 'undefined'
          ? `${window.location.origin}/agroswap-base-sepolia.tokenlist.json?t=${Date.now()}`
          : `/agroswap-base-sepolia.tokenlist.json?t=${Date.now()}`
      const res = await fetch(url, { credentials: 'omit', cache: 'no-cache' })
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

  if (chainFilter === UniverseChainId.BaseSepolia) {
    const data =
      baseSepoliaListQuery.data?.filter((c) => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        const addr = c.currency.isToken ? c.currency.address.toLowerCase() : ''
        return (
          c.currency.symbol?.toLowerCase().includes(q) ||
          c.currency.name?.toLowerCase().includes(q) ||
          addr.includes(q)
        )
      }) ?? []

    return {
      data,
      loading: baseSepoliaListQuery.isLoading || baseSepoliaListQuery.isFetching,
      error: baseSepoliaListQuery.error ?? undefined,
      refetch: baseSepoliaListQuery.refetch,
    }
  }

  const variables = useMemo(
    () => ({
      searchQuery: searchQuery ?? undefined,
      chainIds: chainFilter ? [chainFilter] : enabledChainIds,
      searchType: SearchType.TOKEN,
      page: 1,
      size,
      prioritizeSvm: isSvmConnected,
    }),
    [searchQuery, chainFilter, size, enabledChainIds, isSvmConnected],
  )

  const tokenSelect = useEvent((data: SearchTokensResponse): CurrencyInfo[] => {
    return data.tokens
      .map((token) => searchTokenToCurrencyInfo(token))
      .filter((c): c is CurrencyInfo => {
        if (!c) {
          return false
        }
        // Filter out WSOL from Solana search results when hideWSOL is true
        if (hideWSOL && isWSOL(c.currency)) {
          return false
        }
        return true
      })
  })

  const {
    data: tokens,
    error,
    isPending,
    refetch,
  } = useSearchTokensAndPoolsQuery<CurrencyInfo[]>({
    input: variables,
    enabled: !skip,
    select: tokenSelect,
  })

  return useMemo(
    () => ({ data: tokens, loading: isPending, error: error ?? undefined, refetch }),
    [tokens, isPending, error, refetch],
  )
}
