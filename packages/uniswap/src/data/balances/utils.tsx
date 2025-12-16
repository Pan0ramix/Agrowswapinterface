import { GetPortfolioResponse } from '@uniswap/client-data-api/dist/data/v1/api_pb'
import { GraphQLApi } from '@universe/api'
import { useMemo } from 'react'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { isPortfolioSupportedChain } from 'uniswap/src/features/portfolio/utils/chainSupport'
import { logger } from 'utilities/src/logger/logger'

/**
 * Computes the total balances in USD per chain asynchronously to avoid blocking the main thread.
 */
export function useTotalBalancesUsdPerChain(
  portfolioBalances: GraphQLApi.PortfolioBalancesQueryResult,
): Record<string, number> | undefined {
  const { gqlChains, defaultChainId } = useEnabledChains()
  const tokenBalances = portfolioBalances.data?.portfolios?.[0]?.tokenBalances
  const disablePortfolio = !isPortfolioSupportedChain(defaultChainId)

  return useMemo(() => {
    if (disablePortfolio || !tokenBalances || !gqlChains.length) {
      return undefined
    }

    try {
      return gqlChains.reduce(
        (chainAcc, chain) => {
          chainAcc[chain] =
            tokenBalances.reduce((balanceAcc, tokenBalance) => {
              if (tokenBalance?.token?.chain === chain && !tokenBalance.isHidden) {
                return balanceAcc + (tokenBalance.denominatedValue?.value || 0)
              }
              return balanceAcc
            }, 0) || 0
          return chainAcc
        },
        {} as Record<string, number>,
      )
    } catch (error) {
      logger.error('useTotalBalancesUsdPerChain', error)
      return undefined
    }
  }, [disablePortfolio, gqlChains, tokenBalances])
}

/**
 * Computes the total balances in USD per chain for telemetry purposes
 */
export function calculateTotalBalancesUsdPerChainRest(
  portfolioData: GetPortfolioResponse | undefined,
): Record<string, number> | undefined {
  if (!portfolioData?.portfolio?.balances) {
    return undefined
  }

  try {
    return portfolioData.portfolio.balances.reduce((balancesByChain: Record<string, number>, balance) => {
      if (!balance.token) {
        return balancesByChain
      }

      const chainId = balance.token.chainId
      // using capitalized chain name to keep data consistent with legacy gql endpoint
      const chainName = getChainInfo(chainId).label.toUpperCase()
      const balanceUsd = balance.valueUsd

      balancesByChain[chainName] = (balancesByChain[chainName] ?? 0) + balanceUsd
      return balancesByChain
    }, {})
  } catch (error) {
    logger.error(error, {
      tags: { file: 'balances/utils', function: 'calculateTotalBalancesUsdPerChainRest' },
    })
    return undefined
  }
}
