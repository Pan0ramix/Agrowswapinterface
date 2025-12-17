import { type TransactionRequest } from '@ethersproject/providers'
import { keepPreviousData, skipToken, type UseQueryResult } from '@tanstack/react-query'
import {
  type UseQueryWithImmediateGarbageCollectionApiHelperHookArgs,
  useQueryWithImmediateGarbageCollection,
} from '@universe/api'
import { useStatsigClientStatus } from '@universe/gating'
import { useMemo } from 'react'
import { config } from 'uniswap/src/config'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import {
  createFetchGasFee,
  type GasFeeResultWithoutState,
} from 'uniswap/src/data/apiClients/uniswapApi/UniswapApiClient'
import { getActiveGasStrategy } from 'uniswap/src/features/gas/utils'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export function useGasFeeQuery({
  params,
  // Warning: only use when it's Ok to return old data even when params change.
  shouldUsePreviousValueDuringLoading,
  ...rest
}: UseQueryWithImmediateGarbageCollectionApiHelperHookArgs<
  { tx: TransactionRequest; fallbackGasLimit?: number; smartContractDelegationAddress?: Address },
  GasFeeResultWithoutState
> & { shouldUsePreviousValueDuringLoading?: boolean }): UseQueryResult<GasFeeResultWithoutState> {
  const { isStatsigReady } = useStatsigClientStatus()

  // Gate: Check if Uniswap API is configured (not localhost/dev)
  // Disable query if API not configured to prevent 400 errors
  const isApiConfigured = useMemo(() => {
    const apiBaseUrl = uniswapUrls.apiBaseUrl
    return (
      apiBaseUrl &&
      apiBaseUrl.trim() !== '' &&
      !apiBaseUrl.includes('localhost') &&
      !apiBaseUrl.includes('127.0.0.1') &&
      config.uniswapApiKey &&
      config.uniswapApiKey.trim() !== ''
    )
  }, [])

  const queryKey = [ReactQueryCacheKey.UniswapApi, uniswapUrls.gasServicePath, params]

  return useQueryWithImmediateGarbageCollection<GasFeeResultWithoutState>({
    queryKey,
    queryFn:
      params && isApiConfigured
        ? (): Promise<GasFeeResultWithoutState> => fetchGasFeeQuery({ ...params, isStatsigReady })
        : skipToken,
    enabled: isApiConfigured && rest.enabled !== false && !!params,
    ...(shouldUsePreviousValueDuringLoading && { placeholderData: keepPreviousData }),
    ...rest,
  })
}

export async function fetchGasFeeQuery(params: {
  tx: TransactionRequest
  fallbackGasLimit?: number
  smartContractDelegationAddress?: Address
  isStatsigReady: boolean
}): Promise<GasFeeResultWithoutState> {
  const { tx, smartContractDelegationAddress, isStatsigReady } = params
  const gasStrategy = getActiveGasStrategy({ chainId: tx.chainId, type: 'general', isStatsigReady })
  const fetchGasFee = createFetchGasFee({ gasStrategy, smartContractDelegationAddress })
  return fetchGasFee(params)
}
