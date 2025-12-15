import { GqlResult } from '@universe/api'
import { memo, useCallback, useMemo, useRef } from 'react'
import { TokenSelectorOption } from 'uniswap/src/components/lists/items/types'
import { type OnchainItemSection, OnchainItemSectionName } from 'uniswap/src/components/lists/OnchainItemList/types'
import { useOnchainItemListSection } from 'uniswap/src/components/lists/utils'
import { useCommonTokensOptionsWithFallback } from 'uniswap/src/components/TokenSelector/hooks/useCommonTokensOptionsWithFallback'
import { useFavoriteTokensOptions } from 'uniswap/src/components/TokenSelector/hooks/useFavoriteTokensOptions'
import { usePortfolioTokenOptions } from 'uniswap/src/components/TokenSelector/hooks/usePortfolioTokenOptions'
import { useRecentlySearchedTokens } from 'uniswap/src/components/TokenSelector/hooks/useRecentlySearchedTokens'
import { useTrendingTokensOptions } from 'uniswap/src/components/TokenSelector/hooks/useTrendingTokensOptions'
import { TokenSelectorList } from 'uniswap/src/components/TokenSelector/TokenSelectorList'
import { OnSelectCurrency, TokenSectionsHookProps } from 'uniswap/src/components/TokenSelector/types'
import { isSwapListLoading } from 'uniswap/src/components/TokenSelector/utils'
import { useBridgingTokensOptions } from 'uniswap/src/features/bridging/hooks/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { isPortfolioSupportedChain } from 'uniswap/src/features/portfolio/utils/chainSupport'
import { ClearRecentSearchesButton } from 'uniswap/src/features/search/ClearRecentSearchesButton'
import { isMobileApp } from 'utilities/src/platform'

// eslint-disable-next-line complexity
function useTokenSectionsForSwap({
  evmAddress,
  svmAddress,
  chainFilter,
  oppositeSelectedToken,
}: TokenSectionsHookProps): GqlResult<OnchainItemSection<TokenSelectorOption>[]> {
  // Avoid pull from feature-flagged chain selector to keep hook order stable
  // in this fork. Default to Base Sepolia for the swap selector.
  const defaultChainId = chainFilter ?? UniverseChainId.BaseSepolia
  const isTestnetModeEnabled = true
  // Hard-disable portfolio-dependent logic for stability on this fork.
  const disablePortfolio = true

  const {
    data: portfolioTokenOptions = [],
    error: portfolioTokenOptionsError,
    refetch: refetchPortfolioTokenOptions,
    loading: portfolioTokenOptionsLoading = false,
  } = usePortfolioTokenOptions({ evmAddress, svmAddress, chainFilter, disablePortfolio })

  const {
    data: trendingTokenOptions,
    error: trendingTokenOptionsError,
    refetch: refetchTrendingTokenOptions,
    loading: trendingTokenOptionsLoading = false,
  } = useTrendingTokensOptions({ evmAddress, svmAddress, chainFilter, disablePortfolio })
  
  // Debug logging
  console.log('[TokenSelector] Trending tokens:', {
    optionsLength: trendingTokenOptions?.length,
    options: trendingTokenOptions?.map(t => t.currencyInfo.currency.symbol),
    loading: trendingTokenOptionsLoading,
    error: trendingTokenOptionsError,
    chainFilter,
  })

  const {
    data: favoriteTokenOptions = [],
    error: favoriteTokenOptionsError,
    refetch: refetchFavoriteTokenOptions,
    loading: favoriteTokenOptionsLoading = false,
  } = useFavoriteTokensOptions({ evmAddress, svmAddress, chainFilter, disablePortfolio })

  const {
    data: commonTokenOptions = [],
    error: commonTokenOptionsError,
    refetch: refetchCommonTokenOptions,
    loading: commonTokenOptionsLoading = false,
    // if there is no chain filter, first check if the input token has a chainId, fallback to defaultChainId
  } = useCommonTokensOptionsWithFallback({
    evmAddress,
    svmAddress,
    chainFilter: chainFilter ?? oppositeSelectedToken?.chainId ?? defaultChainId,
    disablePortfolio,
  })

  const {
    data: bridgingTokenOptions,
    error: bridgingTokenOptionsError,
    refetch: refetchBridgingTokenOptions,
    loading: bridgingTokenOptionsLoading,
    shouldNest: shouldNestBridgingTokens,
  } = useBridgingTokensOptions({
    oppositeSelectedToken,
    evmAddress,
    svmAddress,
    chainFilter,
    disablePortfolio,
  })

  const recentlySearchedTokenOptions = disablePortfolio ? [] : useRecentlySearchedTokens(chainFilter)

  const error =
    (!portfolioTokenOptions && portfolioTokenOptionsError) ||
    (trendingTokenOptions === undefined && trendingTokenOptionsError) ||
    (!favoriteTokenOptions && favoriteTokenOptionsError) ||
    (!commonTokenOptions && commonTokenOptionsError) ||
    (!bridgingTokenOptions && bridgingTokenOptionsError)

  const loading =
    (!portfolioTokenOptions && portfolioTokenOptionsLoading) ||
    (trendingTokenOptions === undefined && trendingTokenOptionsLoading) ||
    (!favoriteTokenOptions && favoriteTokenOptionsLoading) ||
    (!commonTokenOptions && commonTokenOptionsLoading) ||
    (!bridgingTokenOptions && bridgingTokenOptionsLoading)

  const refetchAllRef = useRef<() => void>(() => {})

  refetchAllRef.current = (): void => {
    refetchPortfolioTokenOptions?.()
    refetchTrendingTokenOptions?.()
    refetchFavoriteTokenOptions?.()
    refetchCommonTokenOptions?.()
    refetchBridgingTokenOptions?.()
  }

  const refetch = useCallback(() => {
    refetchAllRef.current()
  }, [])

  // we draw the Suggested pills as a single item of a section list, so `data` is TokenOption[][]

  const suggestedSectionOptions = useMemo(() => {
    return [commonTokenOptions ?? []]
  }, [commonTokenOptions])
  
  const suggestedSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.SuggestedTokens,
    options: suggestedSectionOptions,
  })

  const portfolioSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.YourTokens,
    options: portfolioTokenOptions,
  })

  const memoizedEndElement = useMemo(() => <ClearRecentSearchesButton />, [])
  const recentSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.RecentSearches,
    options: disablePortfolio ? [] : recentlySearchedTokenOptions,
    endElement: memoizedEndElement,
  })
  const favoriteSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.FavoriteTokens,
    options: favoriteTokenOptions,
  })
  const trendingSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.TrendingTokens,
    // Only pass options if we have actual data (not undefined, and not empty array from trading API)
    options: trendingTokenOptions && trendingTokenOptions.length > 0 ? trendingTokenOptions : undefined,
  })
  
  console.log('[TokenSelector] Trending section:', {
    section: trendingSection,
    sectionLength: trendingSection?.length,
    hasData: trendingSection?.[0]?.data?.length,
  })
  const bridgingSectionTokenOptions: TokenSelectorOption[] = useMemo(
    () => (shouldNestBridgingTokens ? [bridgingTokenOptions ?? []] : (bridgingTokenOptions ?? [])),
    [bridgingTokenOptions, shouldNestBridgingTokens],
  )

  const bridgingSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.BridgingTokens,
    options: bridgingSectionTokenOptions,
  })

  const sections = useMemo(() => {
    // Temporarily disable loading check for testnet to debug
    const isLoading = isTestnetModeEnabled ? false : isSwapListLoading({ loading, portfolioSection, trendingSection, isTestnetModeEnabled })
    console.log('[TokenSelector] Sections calculation:', {
      isLoading,
      loading,
      hasPortfolioSection: !!portfolioSection,
      hasTrendingSection: !!trendingSection,
      isTestnetModeEnabled,
      suggestedSectionLength: suggestedSection?.length,
      portfolioSectionLength: portfolioSection?.length,
      trendingSectionLength: trendingSection?.length,
    })
    
    if (isLoading) {
      console.log('[TokenSelector] Still loading, returning undefined')
      return undefined
    }

    if (isTestnetModeEnabled) {
      // In testnet mode, show suggested tokens, portfolio tokens, and trending tokens (which includes all tokens from the token list)
      const result = [
        ...(suggestedSection ?? []),
        ...(portfolioSection ?? []),
        ...(trendingSection ?? []),
      ]
      console.log('[TokenSelector] Testnet sections result:', {
        totalSections: result.length,
        sections: result.map(s => ({ key: s.sectionKey, dataLength: Array.isArray(s.data) ? s.data.length : 'N/A' })),
      })
      return result
    }

    return [
      ...(suggestedSection ?? []),
      ...(bridgingSection ?? []),
      ...(portfolioSection ?? []),
      ...(recentSection ?? []),
      // TODO(WEB-3061): Favorited wallets/tokens
      // Extension & interface do not support favoriting but has a default list, so we can't rely on empty array check
      ...(isMobileApp ? (favoriteSection ?? []) : []),
      ...(trendingSection ?? []),
    ]
  }, [
    loading,
    portfolioSection,
    trendingSection,
    suggestedSection,
    bridgingSection,
    recentSection,
    favoriteSection,
    isTestnetModeEnabled,
  ])

  return useMemo(
    () => ({
      data: sections,
      loading,
      error: error || undefined,
      refetch,
    }),
    [error, loading, refetch, sections],
  )
}

function _TokenSelectorSwapList({
  onSelectCurrency,
  evmAddress,
  svmAddress,
  chainFilter,
  oppositeSelectedToken,
  renderedInModal,
}: TokenSectionsHookProps & {
  onSelectCurrency: OnSelectCurrency
  chainFilter: UniverseChainId | null
  renderedInModal: boolean
}): JSX.Element {
  const {
    data: sections,
    loading,
    error,
    refetch,
  } = useTokenSectionsForSwap({
    evmAddress,
    svmAddress,
    chainFilter,
    oppositeSelectedToken,
  })
  return (
    <TokenSelectorList
      showTokenAddress
      chainFilter={chainFilter}
      hasError={Boolean(error)}
      loading={loading}
      refetch={refetch}
      sections={sections}
      showTokenWarnings={true}
      renderedInModal={renderedInModal}
      onSelectCurrency={onSelectCurrency}
    />
  )
}

export const TokenSelectorSwapList = memo(_TokenSelectorSwapList)
