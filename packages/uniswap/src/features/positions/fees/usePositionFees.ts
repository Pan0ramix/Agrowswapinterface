/**
 * Position Fees Resolver Hook
 *
 * Resolves position fees from multiple providers in priority order:
 * 1. collect_simulation (authoritative)
 * 2. onchain_math (estimated)
 * 3. graphql_indexer (estimated)
 *
 * Runs providers in parallel when possible for better performance.
 */

import { skipToken, useQuery } from '@tanstack/react-query'
import { Currency, NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { getPositionManagerAddress } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import type { FeeDataSource, PositionFees } from 'uniswap/src/features/positions/fees/feeProviders'
import { collectSimulationProvider } from 'uniswap/src/features/positions/fees/providers/collectSimulationProvider'
import { positionInfoToPositionFees } from 'uniswap/src/features/positions/fees/providers/graphqlFeesProvider'
import { onchainMathFeesProvider } from 'uniswap/src/features/positions/fees/providers/onchainMathFeesProvider'
import { logger } from 'utilities/src/logger/logger'

export interface UsePositionFeesParams {
  chainId: EVMUniverseChainId | undefined
  tokenId: string | undefined
  account: string | undefined
  positionManagerAddress?: string
  // Fallback data from positionInfo (GraphQL/indexer source)
  positionInfoFee0Amount?: import('@uniswap/sdk-core').CurrencyAmount<Currency>
  positionInfoFee1Amount?: import('@uniswap/sdk-core').CurrencyAmount<Currency>
  positionInfoToken0?: Currency
  positionInfoToken1?: Currency
  enabled?: boolean
}

export interface UsePositionFeesReturn {
  data?: PositionFees
  isLoading: boolean
  isError: boolean
  error?: Error
  source?: FeeDataSource
  refetch: () => void
}

/**
 * Resolve position fees from multiple providers in priority order
 */
export function usePositionFees(params: UsePositionFeesParams): UsePositionFeesReturn {
  const {
    chainId,
    tokenId,
    account,
    positionManagerAddress,
    positionInfoFee0Amount,
    positionInfoFee1Amount,
    positionInfoToken0,
    positionInfoToken1,
    enabled = true,
  } = params

  // Get position manager address (resolve from config like useOnChainCollectableFees)
  const pmAddress = useMemo(() => {
    if (positionManagerAddress) {
      return positionManagerAddress
    }
    if (!chainId) {
      return undefined
    }
    try {
      // Try Agroswap addresses first (Base Sepolia)
      if (chainId === 84532) {
        const address =
          AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[
            chainId as keyof typeof AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
          ]
        if (address) {
          return address
        }
      }

      // Try v3Addresses override
      const v3Address = getPositionManagerAddress(chainId)
      if (v3Address) {
        return v3Address
      }

      // Fall back to SDK addresses
      const sdkAddress =
        NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
      return sdkAddress || undefined
    } catch (error) {
      logger.error(error, {
        tags: { file: 'usePositionFees', function: 'usePositionFees' },
        extra: { chainId },
      })
      return undefined
    }
  }, [chainId, positionManagerAddress])

  const queryKey = useMemo(() => {
    if (!chainId || !pmAddress || !tokenId || !account) {
      return skipToken
    }
    return ['positionFees', chainId, pmAddress, tokenId, account] as const
  }, [chainId, pmAddress, tokenId, account])

  const queryFn = useMemo(() => {
    if (!chainId || !pmAddress || !tokenId || !account) {
      return skipToken
    }

    return async (): Promise<PositionFees> => {
      const providerParams = {
        chainId,
        tokenId,
        account,
        positionManagerAddress: pmAddress,
      }

      // Priority 1 & 2: Try collect simulation (authoritative) and onchain_math (estimated) in parallel
      const [collectResult, onchainMathResult] = await Promise.all([
        collectSimulationProvider(providerParams),
        onchainMathFeesProvider(providerParams),
      ])

      // Debug logging (dev-only) to track provider selection
      if (process.env.NODE_ENV !== 'production') {
        logger.debug(
          {
            tags: { file: 'usePositionFees', function: 'usePositionFees' },
            extra: {
              chainId,
              tokenId,
              account,
              collectResult: { ok: collectResult.ok, reason: collectResult.reason, source: collectResult.source },
              onchainMathResult: {
                ok: onchainMathResult.ok,
                reason: onchainMathResult.reason,
                source: onchainMathResult.source,
              },
              hasGraphQLFallback: !!(positionInfoFee0Amount && positionInfoFee1Amount),
            },
          },
          'Position fees provider results',
        )
      }

      // Priority 1: Use collect simulation if successful (authoritative)
      if (collectResult.ok) {
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(
            {
              tags: { file: 'usePositionFees', function: 'usePositionFees' },
              extra: {
                chainId,
                tokenId,
                source: collectResult.data.source,
                isAuthoritative: collectResult.data.isAuthoritative,
              },
            },
            'Selected collect_simulation provider (authoritative)',
          )
        }
        return collectResult.data
      }

      // Priority 2: Use onchain_math if successful (estimated)
      if (onchainMathResult.ok) {
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(
            {
              tags: { file: 'usePositionFees', function: 'usePositionFees' },
              extra: {
                chainId,
                tokenId,
                source: onchainMathResult.data.source,
                isAuthoritative: onchainMathResult.data.isAuthoritative,
                collectError: collectResult.reason,
              },
            },
            'Selected onchain_math provider (estimated fallback)',
          )
        }
        logger.warn(
          {
            tags: { file: 'usePositionFees', function: 'usePositionFees' },
            extra: {
              chainId,
              tokenId,
              note: 'Using onchain_math fees (collect simulation failed)',
              collectError: collectResult.reason,
            },
          },
          'Using estimated onchain_math fees',
        )
        return onchainMathResult.data
      }

      // Priority 3: Fall back to positionInfo (GraphQL/indexer) if available
      if (positionInfoFee0Amount && positionInfoFee1Amount && positionInfoToken0 && positionInfoToken1) {
        const graphqlFees = positionInfoToPositionFees(
          positionInfoFee0Amount,
          positionInfoFee1Amount,
          positionInfoToken0,
          positionInfoToken1,
        )

        if (graphqlFees) {
          if (process.env.NODE_ENV !== 'production') {
            logger.debug(
              {
                tags: { file: 'usePositionFees', function: 'usePositionFees' },
                extra: {
                  chainId,
                  tokenId,
                  source: graphqlFees.source,
                  isAuthoritative: graphqlFees.isAuthoritative,
                  collectError: collectResult.reason,
                  onchainMathError: onchainMathResult.reason,
                },
              },
              'Selected graphql_indexer provider (fallback)',
            )
          }
          logger.warn(
            {
              tags: { file: 'usePositionFees', function: 'usePositionFees' },
              extra: {
                chainId,
                tokenId,
                note: 'Using fallback GraphQL/indexer fees (onchain providers failed)',
                collectError: collectResult.reason,
                onchainMathError: onchainMathResult.reason,
              },
            },
            'Using fallback GraphQL/indexer fees',
          )
          return graphqlFees
        }
      }

      // No data available - throw to trigger React Query error state
      const errorMessage = `Failed to fetch fees from any provider. Collect simulation: ${collectResult.reason || 'unknown'}. Onchain math: ${onchainMathResult.reason || 'unknown'}. GraphQL fallback: ${positionInfoFee0Amount ? 'available but failed' : 'unavailable'}`

      if (process.env.NODE_ENV !== 'production') {
        logger.debug(
          {
            tags: { file: 'usePositionFees', function: 'usePositionFees' },
            extra: {
              chainId,
              tokenId,
              account,
              collectResult: { ok: false, reason: collectResult.reason, source: collectResult.source },
              onchainMathResult: { ok: false, reason: onchainMathResult.reason, source: onchainMathResult.source },
              hasGraphQLFallback: !!(positionInfoFee0Amount && positionInfoFee1Amount),
            },
          },
          'All fee providers failed',
        )
      }

      throw new Error(errorMessage)
    }
  }, [
    chainId,
    pmAddress,
    tokenId,
    account,
    positionInfoFee0Amount,
    positionInfoFee1Amount,
    positionInfoToken0,
    positionInfoToken1,
  ])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && queryFn !== skipToken,
    staleTime: 10_000, // 10 seconds
    gcTime: 30_000, // 30 seconds
    retry: 2,
    retryDelay: 1000,
  })

  return {
    data,
    isLoading,
    isError,
    error: isError ? (error instanceof Error ? error : new Error(String(error))) : undefined,
    source: data?.source,
    refetch,
  }
}
