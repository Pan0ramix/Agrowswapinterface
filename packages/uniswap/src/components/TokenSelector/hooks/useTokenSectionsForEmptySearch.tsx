import { GqlResult } from '@universe/api'
import { useMemo } from 'react'
import { TokenOption } from 'uniswap/src/components/lists/items/types'
import { type OnchainItemSection, OnchainItemSectionName } from 'uniswap/src/components/lists/OnchainItemList/types'
import { useOnchainItemListSection } from 'uniswap/src/components/lists/utils'
import { MAX_DEFAULT_TRENDING_TOKEN_RESULTS_AMOUNT } from 'uniswap/src/components/TokenSelector/constants'
import { useRecentlySearchedTokens } from 'uniswap/src/components/TokenSelector/hooks/useRecentlySearchedTokens'
import { useTrendingTokensOptions } from 'uniswap/src/components/TokenSelector/hooks/useTrendingTokensOptions'
import { TokenSectionsHookProps } from 'uniswap/src/components/TokenSelector/types'
import { ClearRecentSearchesButton } from 'uniswap/src/features/search/ClearRecentSearchesButton'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

export function useTokenSectionsForEmptySearch({
  evmAddress,
  svmAddress,
  chainFilter,
}: Omit<TokenSectionsHookProps, 'oppositeSelectedToken'>): GqlResult<OnchainItemSection<TokenOption>[]> {
  const { data: trendingTokenOptions, loading } = useTrendingTokensOptions({ evmAddress, svmAddress, chainFilter })

  const recentlySearchedTokenOptions = useRecentlySearchedTokens(chainFilter)

  const recentSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.RecentSearches,
    options: recentlySearchedTokenOptions,
    endElement: <ClearRecentSearchesButton />,
  })

  // For Base Sepolia, show all tokens from the token list (no limit)
  // For other chains, limit to MAX_DEFAULT_TRENDING_TOKEN_RESULTS_AMOUNT
  const trendingTokensToShow = useMemo(() => {
    if (chainFilter === UniverseChainId.BaseSepolia) {
      // Show all tokens for Base Sepolia since it's a testnet with a small curated list
      return trendingTokenOptions
    }
    return trendingTokenOptions?.slice(0, MAX_DEFAULT_TRENDING_TOKEN_RESULTS_AMOUNT)
  }, [trendingTokenOptions, chainFilter])

  const trendingSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.TrendingTokens,
    options: trendingTokensToShow,
  })
  const sections = useMemo(
    () => [...(recentSection ?? []), ...(trendingSection ?? [])],
    [trendingSection, recentSection],
  )

  return useMemo(
    () => ({
      data: sections,
      loading,
    }),
    [loading, sections],
  )
}
