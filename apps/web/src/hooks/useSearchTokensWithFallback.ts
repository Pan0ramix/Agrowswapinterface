import { Contract } from '@ethersproject/contracts'
import { useQuery } from '@tanstack/react-query'
import { Token } from '@uniswap/sdk-core'
import { GqlResult } from '@universe/api'
import { getTokensAsync } from 'components/AccountDrawer/MiniPortfolio/Pools/getTokensAsync'
import { useAccount } from 'hooks/useAccount'
import { useInterfaceMulticall } from 'hooks/useContract'
import { useEthersProvider } from 'hooks/useEthersProvider'
import { useMemo } from 'react'
import ERC20_ABI from 'uniswap/src/abis/erc20.json'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { useSearchTokens } from 'uniswap/src/features/dataApi/searchTokens'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrency, buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { isEVMChain } from 'uniswap/src/features/platforms/utils/chains'
import { getValidAddress } from 'uniswap/src/utils/addresses'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { DEFAULT_ERC20_DECIMALS } from 'utilities/src/tokens/constants'

const _LOG_PREFIX = '[useSearchTokensWithFallback]'

/**
 * Fetch token metadata directly from blockchain using RPC calls (fallback when multicall is unavailable)
 */
async function fetchTokenDirectlyFromRPC({
  address,
  chainId,
  provider,
}: {
  address: string
  chainId: UniverseChainId
  provider: any
}): Promise<Token | null> {
  try {
    const contract = new Contract(address, ERC20_ABI, provider)

    // Try to fetch name, symbol, and decimals
    const [name, symbol, decimals] = await Promise.all([
      contract.name().catch(() => null),
      contract.symbol().catch(() => null),
      contract.decimals().catch(() => null),
    ])

    if (!name && !symbol) {
      return null
    }

    const tokenDecimals = decimals !== null && decimals !== undefined ? Number(decimals) : DEFAULT_ERC20_DECIMALS
    const tokenName = name || 'Unknown Token'
    const tokenSymbol = symbol || 'UNKNOWN'

    const token = new Token(chainId, address, tokenDecimals, tokenSymbol, tokenName)

    return token
  } catch (_error) {
    return null
  }
}

/**
 * Enhanced version of useSearchTokens that falls back to on-chain fetching
 * when the API search returns no results and the search query looks like an address.
 * Supports both multicall and direct RPC fallbacks.
 */
export function useSearchTokensWithFallback({
  searchQuery,
  chainFilter,
  skip,
  size,
  hideWSOL = false,
}: {
  searchQuery: string | null
  chainFilter: UniverseChainId | null
  skip: boolean
  size?: number
  hideWSOL?: boolean
}): GqlResult<CurrencyInfo[]> {
  // Get active chain ID as fallback
  const account = useAccount()
  const activeChainId = account.chainId

  // Use chainFilter if provided, otherwise fall back to active chain
  const effectiveChainFilter = chainFilter ?? (activeChainId ? (activeChainId as UniverseChainId) : null)

  // First, try the API search
  const apiSearchResult = useSearchTokens({
    searchQuery,
    chainFilter,
    skip,
    size,
    hideWSOL,
  })

  // Check if we should try on-chain fallback
  const shouldTryFallback = useMemo(() => {
    if (skip) {
      return false
    }

    if (!searchQuery) {
      return false
    }

    if (!effectiveChainFilter) {
      return false
    }

    if (!isEVMChain(effectiveChainFilter)) {
      return false
    }

    // Only try fallback if API search returned no results and query looks like an address
    const isValidAddress = effectiveChainFilter
      ? getValidAddress({
          address: searchQuery,
          chainId: effectiveChainFilter,
        })
      : null

    const shouldFallback =
      isValidAddress !== null &&
      !apiSearchResult.loading &&
      (!apiSearchResult.data || apiSearchResult.data.length === 0)

    if (shouldFallback) {
    } else {
    }

    return shouldFallback
  }, [skip, searchQuery, effectiveChainFilter, apiSearchResult.loading, apiSearchResult.data])

  const multicall = useInterfaceMulticall(effectiveChainFilter ?? undefined)
  const provider = useEthersProvider({ chainId: effectiveChainFilter ?? undefined })

  // Try to fetch token from chain if API search failed
  const onChainTokenQuery = useQuery({
    queryKey: ['fetchTokenFromChain', effectiveChainFilter, searchQuery],
    queryFn: async () => {
      if (!effectiveChainFilter || !searchQuery) {
        return null
      }

      const validAddress = effectiveChainFilter
        ? getValidAddress({
            address: searchQuery,
            chainId: effectiveChainFilter,
            withEVMChecksum: true,
          })
        : null

      if (!validAddress) {
        return null
      }

      let token: Token | null = null

      // Try multicall first if available
      if (multicall) {
        try {
          const tokenMap = await getTokensAsync({
            addresses: [validAddress],
            chainId: effectiveChainFilter,
            multicall,
          })

          token = tokenMap[validAddress] ?? null
          if (token) {
          } else {
          }
        } catch (_error) {}
      } else {
      }

      // Fallback to direct RPC if multicall failed or is unavailable
      if (!token && provider) {
        token = await fetchTokenDirectlyFromRPC({
          address: validAddress,
          chainId: effectiveChainFilter,
          provider,
        })
      } else if (!token && !provider) {
        return null
      }

      if (!token) {
        return null
      }

      const currency = buildCurrency({
        chainId: token.chainId,
        address: token.address,
        decimals: token.decimals,
        symbol: token.symbol,
        name: token.name,
      })

      if (!currency || !currency.isToken) {
        return null
      }

      const currencyInfo = buildCurrencyInfo({
        currency,
        currencyId: currencyId(currency),
        logoUrl: undefined,
        safetyInfo: undefined,
      })

      return currencyInfo
    },
    enabled: shouldTryFallback && (!!multicall || !!provider),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  // Combine API results with on-chain fallback
  const combinedResults = useMemo(() => {
    const apiResults = apiSearchResult.data ?? []
    const onChainResult = onChainTokenQuery.data

    if (onChainResult) {
      // Check if the on-chain token is already in API results
      const alreadyExists = apiResults.some((result) => {
        const resultAddress = result.currency.isToken ? result.currency.address : null
        const onChainAddress = onChainResult.currency.isToken ? onChainResult.currency.address : null
        return resultAddress && onChainAddress && resultAddress.toLowerCase() === onChainAddress.toLowerCase()
      })

      if (alreadyExists) {
        return apiResults
      }

      return [...apiResults, onChainResult]
    }

    return apiResults
  }, [apiSearchResult.data, onChainTokenQuery.data])

  const loading = apiSearchResult.loading || (shouldTryFallback && onChainTokenQuery.isPending)
  const error = apiSearchResult.error

  const finalResult = useMemo(
    () => ({
      data: combinedResults,
      loading,
      error,
      refetch: apiSearchResult.refetch,
    }),
    [combinedResults, loading, error, apiSearchResult.refetch],
  )

  return finalResult
}
