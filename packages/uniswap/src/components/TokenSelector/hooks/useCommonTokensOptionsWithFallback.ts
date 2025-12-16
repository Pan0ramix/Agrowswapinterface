import { GqlResult } from '@universe/api'
import { useMemo } from 'react'
import { TokenOption } from 'uniswap/src/components/lists/items/types'
import { useCommonTokensOptions } from 'uniswap/src/components/TokenSelector/hooks/useCommonTokensOptions'
import { useCurrencies } from 'uniswap/src/components/TokenSelector/hooks/useCurrencies'
import {
  currencyInfosToTokenOptions,
  useCurrencyInfosToTokenOptions,
} from 'uniswap/src/components/TokenSelector/hooks/useCurrencyInfosToTokenOptions'
import { COMMON_BASES } from 'uniswap/src/constants/routing'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { currencyId } from 'uniswap/src/utils/currencyId'

export function useCommonTokensOptionsWithFallback({
  evmAddress,
  svmAddress,
  chainFilter,
  disablePortfolio = false,
}: {
  evmAddress: Address | undefined
  svmAddress: Address | undefined
  chainFilter: UniverseChainId | null
  disablePortfolio?: boolean
}): GqlResult<TokenOption[] | undefined> {
  const { data, error, refetch, loading } = useCommonTokensOptions({
    evmAddress,
    svmAddress,
    chainFilter,
    disablePortfolio,
  })

  const commonBases = chainFilter ? currencyInfosToTokenOptions(COMMON_BASES[chainFilter]) : undefined

  const commonBasesCurrencyIds = useMemo(
    () => commonBases?.map((token) => currencyId(token.currencyInfo.currency)).filter(Boolean) ?? [],
    [commonBases],
  )
  const { data: commonBasesCurrencies } = useCurrencies(commonBasesCurrencyIds)

  const commonBasesTokenOptions = useCurrencyInfosToTokenOptions({
    currencyInfos: commonBasesCurrencies,
    portfolioBalancesById: disablePortfolio ? undefined : {},
  })

  const shouldFallback = (data?.length ?? 0) === 0 && (commonBases?.length ?? 0) > 0

  return useMemo(() => {
    // When falling back, prefer commonBasesTokenOptions (enriched with GraphQL data) only if it has
    // at least as many tokens as commonBases, otherwise use commonBases directly (synchronous fallback)
    // This prevents the enriched list (which may be incomplete) from overriding the full COMMON_BASES list
    const usingEnrichedFallback =
      shouldFallback &&
      commonBasesTokenOptions &&
      commonBasesTokenOptions.length > 0 &&
      commonBasesTokenOptions.length >= (commonBases?.length ?? 0)

    const finalData = shouldFallback ? (usingEnrichedFallback ? commonBasesTokenOptions : commonBases) : data

    return {
      data: finalData,
      error: shouldFallback ? undefined : error,
      refetch,
      loading,
    }
  }, [commonBases, commonBasesTokenOptions, data, error, loading, refetch, shouldFallback])
}
