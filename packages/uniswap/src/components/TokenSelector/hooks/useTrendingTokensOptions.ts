import { GqlResult } from '@universe/api'
import { useCallback } from 'react'
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
  // On this fork, when portfolio/trading data is disabled, short-circuit before any queries
  if (disablePortfolio) {
    return { data: [], error: undefined, refetch: undefined, loading: false }
  }

  const {
    data: tokens,
    error: tokensError,
    refetch: refetchTokens,
    loading: loadingTokens,
  } = useTrendingTokensCurrencyInfos(chainFilter, undefined, disablePortfolio)

  const tokenOptions = useCurrencyInfosToTokenOptions({ currencyInfos: tokens, portfolioBalancesById: undefined })

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
