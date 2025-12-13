import { useQuery } from '@tanstack/react-query'
import { Token } from '@uniswap/sdk-core'
import { GqlResult } from '@universe/api'
import { PublicClient, erc20Abi } from 'viem'
import { useChainId } from 'wagmi'

/**
 * Safe wrapper for useChainId that handles cases where wagmi store isn't ready
 * Returns undefined if wagmi store isn't initialized
 */
function useSafeChainId(): number | undefined {
  try {
    return useChainId()
  } catch (error) {
    // If wagmi store isn't ready, return undefined
    // This can happen during SSR or when wagmi provider isn't set up yet
    if (error instanceof Error && (error.message.includes('getSnapshot') || error.message.includes('length') || error.message.includes('undefined'))) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[useSafeChainId] Wagmi store not ready, returning undefined', error)
      }
      return undefined
    }
    // Re-throw if it's a different error
    throw error
  }
}
import { getTokensAsync } from 'components/AccountDrawer/MiniPortfolio/Pools/getTokensAsync'
// Removed useAccount import - using useChainId directly to avoid getSnapshot errors when wagmi store isn't ready
import { useInterfaceMulticall } from 'hooks/useContract'
import { useMemo } from 'react'
import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { useSearchTokens } from 'uniswap/src/features/dataApi/searchTokens'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrency, buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { isEVMChain } from 'uniswap/src/features/platforms/utils/chains'
import { getValidAddress } from 'uniswap/src/utils/addresses'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { DEFAULT_ERC20_DECIMALS } from 'utilities/src/tokens/constants'

const _LOG_PREFIX = '[useSearchTokensWithFallback]'

/**
 * Fetch token metadata directly from blockchain using viem PublicClient (fallback when multicall is unavailable)
 */
async function fetchTokenDirectlyFromRPC({
  address,
  chainId,
  publicClient,
}: {
  address: string
  chainId: UniverseChainId
  publicClient: PublicClient
}): Promise<Token | null> {
  try {
    // Use viem's readContract to fetch token data
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({
        address: address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'name',
      }).catch(() => null),
      publicClient.readContract({
        address: address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'symbol',
      }).catch(() => null),
      publicClient.readContract({
        address: address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'decimals',
      }).catch(() => null),
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
  // Get active chain ID from wallet connection
  // Use safe chainId wrapper to avoid errors when wagmi store isn't ready
  const wagmiChainId = useSafeChainId()
  
  // Use chainId directly - this is more reliable than useAccount which can fail if store isn't ready
  const activeChainId = wagmiChainId ? (wagmiChainId as UniverseChainId) : null

  // Use chainFilter if provided, otherwise fall back to active chain from wallet
  // Only use on-chain fallback when we have a specific chain (either from filter or wallet)
  const effectiveChainFilter = chainFilter ?? activeChainId
  
  console.log('[useSearchTokensWithFallback] Chain detection', {
    chainFilter,
    wagmiChainId,
    activeChainId,
    effectiveChainFilter,
  })

  // First, try the API search
  const apiSearchResult = useSearchTokens({
    searchQuery,
    chainFilter,
    skip,
    size,
    hideWSOL,
  })

  // Must call hooks unconditionally - useInterfaceMulticall will handle undefined chainId gracefully
  const multicall = useInterfaceMulticall(effectiveChainFilter ?? undefined)
  
  // Use viem PublicClient - prefer wallet-connected client, fallback to public RPC
  // This ensures we can fetch tokens even when wallet isn't connected
  const publicClient = useMemo(() => {
    if (!effectiveChainFilter) {
      return undefined
    }
    const client = createViemClient({
      chainId: effectiveChainFilter,
      rpcType: RPCType.Public,
    })
    if (!client) {
      console.warn('[useSearchTokensWithFallback] Failed to create viem client', {
        chainId: effectiveChainFilter,
      })
    } else {
      console.log('[useSearchTokensWithFallback] Created viem client', {
        chainId: effectiveChainFilter,
      })
    }
    return client
  }, [effectiveChainFilter])

  // Check if we should try on-chain fallback
  const shouldTryFallback = useMemo(() => {
    console.log('[useSearchTokensWithFallback] Evaluating shouldTryFallback', {
      searchQuery,
      effectiveChainFilter,
      skip,
      apiLoading: apiSearchResult.loading,
      apiData: apiSearchResult.data,
      apiError: apiSearchResult.error,
    })

    if (!searchQuery) {
      console.log('[useSearchTokensWithFallback] No search query, skipping fallback')
      return false
    }

    if (!effectiveChainFilter) {
      console.log('[useSearchTokensWithFallback] No chain filter, skipping fallback')
      return false
    }

    if (!isEVMChain(effectiveChainFilter)) {
      console.log('[useSearchTokensWithFallback] Not an EVM chain, skipping fallback', {
        chainId: effectiveChainFilter,
      })
      return false
    }

    // Check if the search query looks like an address
    const isValidAddress = effectiveChainFilter
      ? getValidAddress({
          address: searchQuery,
          chainId: effectiveChainFilter,
          log: true, // Enable logging for debugging
        })
      : null

    console.log('[useSearchTokensWithFallback] Address validation result', {
      searchQuery,
      isValidAddress,
      chainId: effectiveChainFilter,
    })

    if (!isValidAddress) {
      console.log('[useSearchTokensWithFallback] Invalid address format, skipping fallback', {
        searchQuery,
      })
      return false
    }

    // If skip is true, we should try on-chain immediately (API won't run)
    if (skip) {
      return true
    }

    // Trigger fallback if:
    // 1. API search returned no results (empty array or undefined), OR
    // 2. API search returned an error (e.g., 401 Unauthorized, network error)
    const hasApiResults = apiSearchResult.data && apiSearchResult.data.length > 0
    const hasApiError = !!apiSearchResult.error
    
    // If API has an error, trigger fallback immediately (don't wait for loading to finish)
    if (hasApiError) {
      console.log('[useSearchTokensWithFallback] API error detected, triggering on-chain fallback', {
        error: apiSearchResult.error,
        searchQuery,
        chainId: effectiveChainFilter,
      })
      return true
    }
    
    // Wait for API to finish loading before deciding
    if (apiSearchResult.loading) {
      return false
    }

    // If API finished loading but returned no results, trigger fallback
    const shouldFallback = !hasApiResults
    
    if (shouldFallback) {
      console.log('[useSearchTokensWithFallback] API returned no results, triggering on-chain fallback', {
        searchQuery,
        chainId: effectiveChainFilter,
        hasPublicClient: !!publicClient,
      })
    }

    return shouldFallback
  }, [skip, searchQuery, effectiveChainFilter, apiSearchResult.loading, apiSearchResult.data, apiSearchResult.error, publicClient])

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
      if (!token && publicClient) {
        try {
          console.log('[useSearchTokensWithFallback] Fetching token from RPC', {
            address: validAddress,
            chainId: effectiveChainFilter,
          })
          token = await fetchTokenDirectlyFromRPC({
            address: validAddress,
            chainId: effectiveChainFilter,
            publicClient,
          })
          if (token) {
            console.log('[useSearchTokensWithFallback] Successfully fetched token from RPC', {
              address: validAddress,
              symbol: token.symbol,
              name: token.name,
            })
          } else {
            console.log('[useSearchTokensWithFallback] Token not found on-chain', {
              address: validAddress,
            })
          }
        } catch (error) {
          // Log error but don't throw - we want to return null gracefully
          console.error('[useSearchTokensWithFallback] Failed to fetch token from RPC:', error)
          return null
        }
      } else if (!token && !publicClient) {
        console.warn('[useSearchTokensWithFallback] No publicClient available for on-chain fetch', {
          address: validAddress,
          chainId: effectiveChainFilter,
        })
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
    enabled: shouldTryFallback && !!publicClient, // Only need publicClient, multicall is optional
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: false, // Don't retry on-chain queries - if it fails, it's likely a real issue
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
  
  // Only show API error if we don't have on-chain results
  // If we successfully fetched the token on-chain, ignore the API error
  const error = combinedResults.length > 0 ? undefined : apiSearchResult.error

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
