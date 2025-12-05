import { GqlResult } from '@universe/api'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TokenOption } from 'uniswap/src/components/lists/items/types'
import { type OnchainItemSection, OnchainItemSectionName } from 'uniswap/src/components/lists/OnchainItemList/types'
import { useOnchainItemListSection } from 'uniswap/src/components/lists/utils'
import { useCurrencyInfosToTokenOptions } from 'uniswap/src/components/TokenSelector/hooks/useCurrencyInfosToTokenOptions'
import { useOnChainTokenByAddress } from 'uniswap/src/components/TokenSelector/hooks/useOnChainTokenByAddress'
import { usePortfolioBalancesForAddressById } from 'uniswap/src/components/TokenSelector/hooks/usePortfolioBalancesForAddressById'
import { usePortfolioTokenOptions } from 'uniswap/src/components/TokenSelector/hooks/usePortfolioTokenOptions'
import { mergeSearchResultsWithBridgingTokens } from 'uniswap/src/components/TokenSelector/utils'
import { TradeableAsset } from 'uniswap/src/entities/assets'
import { useBridgingTokensOptions } from 'uniswap/src/features/bridging/hooks/tokens'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { isPortfolioSupportedChain } from 'uniswap/src/features/portfolio/utils/chainSupport'
import { useSearchTokens } from 'uniswap/src/features/dataApi/searchTokens'
import type { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { getValidAddress } from 'uniswap/src/utils/addresses'
import { areCurrenciesEqual } from 'uniswap/src/utils/currencyId'
import { useChainId } from 'wagmi'

export function useTokenSectionsForSearchResults({
  evmAddress,
  svmAddress,
  chainFilter,
  searchFilter,
  isBalancesOnlySearch,
  input,
}: {
  evmAddress?: string
  svmAddress?: string
  chainFilter: UniverseChainId | null
  searchFilter: string | null
  isBalancesOnlySearch: boolean
  input?: TradeableAsset
}): GqlResult<OnchainItemSection<TokenOption>[]> {
  const { t } = useTranslation()
  const wagmiChainId = useChainId()

  // Use current chain ID from wallet if chainFilter is null (for address searches)
  // Convert wagmi chainId to UniverseChainId if it's a supported chain
  const effectiveChainFilter = chainFilter ?? (wagmiChainId as UniverseChainId | undefined) ?? null
  const disablePortfolio = !isPortfolioSupportedChain(effectiveChainFilter ?? undefined)

  const {
    data: portfolioBalancesById,
    error: portfolioBalancesByIdError,
    refetch: refetchPortfolioBalances,
    loading: portfolioBalancesByIdLoading,
  } = usePortfolioBalancesForAddressById({ evmAddress, svmAddress, disablePortfolio })

  const {
    data: portfolioTokenOptions,
    error: portfolioTokenOptionsError,
    refetch: refetchPortfolioTokenOptions,
    loading: portfolioTokenOptionsLoading,
  } = usePortfolioTokenOptions({
    evmAddress,
    svmAddress,
    chainFilter,
    searchFilter: searchFilter ?? undefined,
    disablePortfolio,
  })

  // Bridging tokens are only shown if input is provided
  const {
    data: bridgingTokenOptions,
    error: bridgingTokenOptionsError,
    refetch: refetchBridgingTokenOptions,
    loading: bridgingTokenOptionsLoading,
  } = useBridgingTokensOptions({ oppositeSelectedToken: input, evmAddress, svmAddress, chainFilter })

  // Check if search filter is a valid address
  const isValidAddress = useMemo(() => {
    if (!searchFilter || !effectiveChainFilter) {
      return false
    }
    const chainInfo = getChainInfo(effectiveChainFilter)
    const validAddress = getValidAddress({
      address: searchFilter,
      platform: chainInfo.platform,
      withEVMChecksum: true,
      log: false,
    })
    const isValid = Boolean(validAddress)

    return isValid
  }, [searchFilter, effectiveChainFilter])

  // Only call search endpoint if isBalancesOnlySearch is false
  const {
    data: searchResultCurrencies,
    error: searchTokensError,
    refetch: refetchSearchTokens,
    loading: searchTokensLoading,
  } = useSearchTokens({
    searchQuery: searchFilter,
    chainFilter,
    skip: isBalancesOnlySearch,
    hideWSOL: true, // Hide WSOL in token selector
  })

  // Fetch token on-chain if search query is a valid address and API returned no results
  // Note: multicall should be passed from the consuming component to avoid cross-package dependencies
  // For now, we'll skip on-chain fetching if multicall is not available
  const multicall = null
  const hasMulticall = false

  // Only attempt on-chain fetch after API search has completed and returned no results
  const shouldFetchOnChain = useMemo(() => {
    // Early returns
    if (isBalancesOnlySearch) {
      return false
    }
    if (!isValidAddress || !searchFilter || !effectiveChainFilter) {
      return false
    }
    if (!hasMulticall) {
      return false
    }
    // Wait for API search to complete
    if (searchTokensLoading) {
      return false
    }
    // Only fetch on-chain if API returned no results (empty array or undefined)
    // Also attempt if API returned an error
    const hasApiResults = searchResultCurrencies && searchResultCurrencies.length > 0
    const shouldFetch = !hasApiResults

    return shouldFetch
  }, [
    isBalancesOnlySearch,
    isValidAddress,
    searchFilter,
    effectiveChainFilter,
    searchTokensLoading,
    searchResultCurrencies,
  ])

  const {
    data: onChainToken,
    loading: onChainTokenLoading,
    error: onChainTokenError,
  } = useOnChainTokenByAddress({
    address: shouldFetchOnChain ? searchFilter : null,
    chainId: shouldFetchOnChain ? effectiveChainFilter : null,
    multicall,
    enabled: shouldFetchOnChain,
  })

  const [selectedNetworkResults, otherNetworksSearchResults] = useMemo((): [CurrencyInfo[], CurrencyInfo[]] => {
    const results: CurrencyInfo[] = []

    // Add API search results
    if (searchResultCurrencies) {
      results.push(...searchResultCurrencies)
    }

    // Add on-chain token if found and not already in results
    if (onChainToken) {
      const alreadyInResults = results.some((c) => areCurrenciesEqual(c.currency, onChainToken.currency))
      if (!alreadyInResults) {
        results.push(onChainToken)
      }
    }

    const selected = results.filter((currency) => !currency.isFromOtherNetwork)
    const other = results.filter((currency) => currency.isFromOtherNetwork)

    return [selected, other]
  }, [searchResultCurrencies, onChainToken])

  const searchResults = useCurrencyInfosToTokenOptions({
    currencyInfos: selectedNetworkResults,
    portfolioBalancesById,
  })

  // Format other networks search results if they exist
  const otherNetworksResults = useCurrencyInfosToTokenOptions({
    currencyInfos: otherNetworksSearchResults,
    portfolioBalancesById,
  })

  const loading =
    portfolioTokenOptionsLoading ||
    portfolioBalancesByIdLoading ||
    (!isBalancesOnlySearch && searchTokensLoading) ||
    (!isBalancesOnlySearch && onChainTokenLoading) ||
    bridgingTokenOptionsLoading

  const searchResultsSections = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.SearchResults,
    // Use local search when only searching balances
    options: isBalancesOnlySearch ? portfolioTokenOptions : searchResults,
  })

  // Create section for other chains search results if they exist
  const otherNetworksSection = useOnchainItemListSection({
    sectionKey: OnchainItemSectionName.OtherChainsTokens,
    options: otherNetworksResults,
  })

  // If there are bridging options, we need to extract them from the search results and then prepend them as a new section above.
  // The remaining non-bridging search results will be shown in a section with a different name
  const networkName = chainFilter ? getChainLabel(chainFilter) : undefined
  const searchResultsSectionHeader = networkName
    ? t('tokens.selector.section.otherSearchResults', { network: networkName })
    : undefined

  const allSections = useMemo(() => {
    // Start with existing sections (bridging tokens + search results)
    const sections =
      mergeSearchResultsWithBridgingTokens({
        searchResults: searchResultsSections,
        bridgingTokens: bridgingTokenOptions,
        sectionHeaderString: searchResultsSectionHeader,
      }) ?? []

    // Add other networks section if it exists
    if (otherNetworksSection?.length) {
      sections.push(...otherNetworksSection)
    }

    return sections
  }, [searchResultsSections, bridgingTokenOptions, searchResultsSectionHeader, otherNetworksSection])

  const hasError =
    (!bridgingTokenOptions && bridgingTokenOptionsError) ||
    (!portfolioBalancesById && portfolioBalancesByIdError) ||
    (!portfolioTokenOptions && portfolioTokenOptionsError) ||
    (!isBalancesOnlySearch && !searchResults && !onChainToken && searchTokensError && !onChainTokenError)

  const error = hasError
    ? ((bridgingTokenOptionsError ||
        portfolioBalancesByIdError ||
        portfolioTokenOptionsError ||
        searchTokensError ||
        onChainTokenError) ??
      undefined)
    : undefined

  const refetchAll = useCallback(() => {
    refetchPortfolioBalances?.()
    refetchSearchTokens?.()
    refetchPortfolioTokenOptions?.()
    refetchBridgingTokenOptions?.()
  }, [refetchBridgingTokenOptions, refetchPortfolioBalances, refetchPortfolioTokenOptions, refetchSearchTokens])

  return useMemo(
    () => ({
      data: allSections,
      loading,
      error,
      refetch: refetchAll,
    }),
    [error, loading, refetchAll, allSections],
  )
}
