import { useQuery } from '@tanstack/react-query'
import { Token } from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { currencyId } from 'uniswap/src/utils/currencyId'

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
  // Only support Base Sepolia with local token list - no trading API
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
      console.log('[TokenList] Fetching token list from:', url)
      const res = await fetch(url, { credentials: 'omit', cache: 'no-cache' })
      if (!res.ok) {
        console.error('[TokenList] Failed to fetch:', res.status, res.statusText)
        throw new Error(`Failed to fetch Base Sepolia token list (${res.status})`)
      }
      const json = await res.json()
      console.log('[TokenList] Raw JSON:', json)
      const tokens = (json?.tokens ?? [])
        .filter((t: any) => t.chainId === UniverseChainId.BaseSepolia)
        .map(
          (t: any) =>
            new Token(UniverseChainId.BaseSepolia, t.address, t.decimals, t.symbol ?? 'UNKNOWN', t.name ?? 'Unknown'),
        )
      console.log(
        '[TokenList] Parsed tokens:',
        tokens.length,
        tokens.map((t) => t.symbol),
      )
      const currencyInfos = tokens.map((token: Token) =>
        buildCurrencyInfo({
          currency: token,
          currencyId: currencyId(token),
          logoUrl: null,
        }),
      )
      console.log('[TokenList] Currency infos:', currencyInfos.length)
      return currencyInfos
    },
  })

  // Only return data for Base Sepolia - other chains return empty (no trading API)
  if (chainFilter === UniverseChainId.BaseSepolia) {
    const result = {
      data: baseSepoliaListQuery.data,
      error: baseSepoliaListQuery.error ?? undefined,
      refetch: baseSepoliaListQuery.refetch,
      loading: baseSepoliaListQuery.isLoading || baseSepoliaListQuery.isFetching,
    }
    console.log('[TokenList] Base Sepolia result:', {
      dataLength: result.data?.length,
      loading: result.loading,
      error: result.error,
      enabled: chainFilter === UniverseChainId.BaseSepolia && !skip,
      queryEnabled: baseSepoliaListQuery.isEnabled,
      queryStatus: baseSepoliaListQuery.status,
    })
    return result
  }

  // For non-Base-Sepolia chains, return empty (trading API removed)
  return {
    data: undefined,
    error: undefined,
    refetch: () => {},
    loading: false,
  }
}
