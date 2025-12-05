import { GqlResult } from '@universe/api'
import { useMemo } from 'react'
import { usePortfolioBalances } from 'uniswap/src/features/dataApi/balances/balances'
import { PortfolioBalance } from 'uniswap/src/features/dataApi/types'

export function usePortfolioBalancesForAddressById({
  evmAddress,
  svmAddress,
  disablePortfolio = false,
}: {
  evmAddress: Address | undefined
  svmAddress?: Address | undefined
  disablePortfolio?: boolean
}): GqlResult<Record<Address, PortfolioBalance> | undefined> {
  if (disablePortfolio) {
    return {
      data: undefined,
      error: undefined,
      refetch: () => undefined,
      loading: false,
    }
  }

  const {
    data: portfolioBalancesById,
    error,
    refetch,
    loading,
  } = usePortfolioBalances({
    evmAddress,
    svmAddress,
    disablePortfolio,
    fetchPolicy: 'cache-first', // we want to avoid re-renders when token selector is opening
  })

  return useMemo(
    () => ({
      data: portfolioBalancesById,
      error,
      refetch,
      loading,
    }),
    [portfolioBalancesById, error, refetch, loading],
  )
}
