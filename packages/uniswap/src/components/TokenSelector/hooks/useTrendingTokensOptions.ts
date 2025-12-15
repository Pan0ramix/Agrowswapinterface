import { GqlResult } from '@universe/api'
import { useCallback, useMemo } from 'react'
import { TokenOption } from 'uniswap/src/components/lists/items/types'
import { useCurrencyInfosToTokenOptions } from 'uniswap/src/components/TokenSelector/hooks/useCurrencyInfosToTokenOptions'
import { usePortfolioBalancesForAddressById } from 'uniswap/src/components/TokenSelector/hooks/usePortfolioBalancesForAddressById'
import { useTrendingTokensCurrencyInfos } from 'uniswap/src/components/TokenSelector/hooks/useTrendingTokensCurrencyInfos'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

export function useTrendingTokensOptions({
  evmAddress,
  svmAddress,
  chainFilter,
  disablePortfolio = false,
}: {
  evmAddress: Address | undefined
  svmAddress: Address | undefined
  chainFilter: Maybe<UniverseChainId>
  disablePortfolio?: boolean
}): GqlResult<TokenOption[] | undefined> {
  // For Base Sepolia, we always want to load the local token list, even if portfolio is disabled
  // For other chains, we still want to use trading API (which doesn't depend on portfolio)
  // Only return empty if we truly have no way to get tokens
  // Note: Trading API should work for non-Base-Sepolia chains regardless of portfolio setting

  const {
    data: tokens,
    error: tokensError,
    refetch: refetchTokens,
    loading: loadingTokens,
  } = useTrendingTokensCurrencyInfos(chainFilter, false, disablePortfolio) // Always enable query, don't skip

  const tokenOptionsFromHook = useCurrencyInfosToTokenOptions({ 
    currencyInfos: tokens, 
    portfolioBalancesById: undefined 
  })
  
  // Return undefined if we don't have data or if the hook returned empty array
  // This prevents creating empty arrays that get filtered out by useOnchainItemListSection
  const tokenOptions = useMemo(() => {
    if (!tokens || tokens.length === 0) {
      return undefined
    }
    // If hook returned empty array, also return undefined
    if (!tokenOptionsFromHook || tokenOptionsFromHook.length === 0) {
      return undefined
    }
    return tokenOptionsFromHook
  }, [tokens, tokenOptionsFromHook])

  const refetch = useCallback(() => {
    refetchTokens()
  }, [refetchTokens])

  const error = !tokenOptions ? tokensError : undefined

  return {
    data: tokenOptions,
    refetch,
    error,
    loading: loadingTokens,
  }
}
