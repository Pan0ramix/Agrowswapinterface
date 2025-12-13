import type { QueryClient, QueryFunction, QueryKey, UseQueryResult } from '@tanstack/react-query'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TradingApi, UseQueryApiHelperHookArgs } from '@universe/api'
import { TradingApi as TradingApiEnum, type SwappableTokensParams } from '@universe/api'
import { useEffect } from 'react'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import type { TradeableAsset } from 'uniswap/src/entities/assets'
import {
  getTokenAddressFromChainForTradingApi,
  toTradingApiSupportedChainId,
} from 'uniswap/src/features/transactions/swap/utils/tradingApi'
import { isTradingApiEnabled } from 'uniswap/src/features/transactions/swap/utils/isTradingApiEnabled'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { isOnChainDebug } from 'uniswap/src/features/transactions/swap/utils/isOnChainDebug'
import { logger } from 'utilities/src/logger/logger'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'
import { MAX_REACT_QUERY_CACHE_TIME_MS } from 'utilities/src/time/time'

export function useTradingApiSwappableTokensQuery({
  params,
  disableTradingApi = false,
  ...rest
}: UseQueryApiHelperHookArgs<
  SwappableTokensParams,
  TradingApi.GetSwappableTokensResponse
> & { disableTradingApi?: boolean }): UseQueryResult<TradingApi.GetSwappableTokensResponse> {
  // Gate Trading API for on-chain-only chains
  const chainId = params?.tokenInChainId
  const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
  const tradingApiDisabled = disableTradingApi || !isTradingApiEnabled(chainId) || isOnChainOnly
  
  // Debug log when Trading API is prevented
  if (isOnChainDebug(chainId) && tradingApiDisabled && params) {
    logger.debug('useTradingApiSwappableTokensQuery', 'useTradingApiSwappableTokensQuery', '[TRADING-API] Prevented swappable_tokens query', {
      chainId,
      tokenInChainId: params.tokenInChainId,
      tokenIn: params.tokenIn,
      reason: isOnChainOnly ? 'on-chain-only chain' : disableTradingApi ? 'explicitly disabled' : 'Trading API not enabled',
      callSite: 'useTradingApiSwappableTokensQuery',
    })
  }
  
  if (tradingApiDisabled) {
    // Return a minimal stub that satisfies the hook contract when disabled.
    return {
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
      isPending: false,
      refetch: async () => ({ data: undefined, error: null, status: 'success' } as any),
      status: 'success' as any,
      fetchStatus: 'idle',
      failureCount: 0,
      isError: false,
      isSuccess: true,
      isStale: false,
      isRefetching: false,
      isFetched: true,
      isFetchedAfterMount: true,
      isPaused: false,
      isPlaceholderData: false,
      isPreviousData: false,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
    } as unknown as UseQueryResult<TradingApi.GetSwappableTokensResponse>
  }

  const queryKey = swappableTokensQueryKey(params)

    // CRITICAL: Ensure tokenInChainId matches active chain and is not on-chain-only
    // Also disable refetchOnWindowFocus for on-chain-only chains
    const shouldEnable = params !== undefined && 
      !isOnChainOnly && 
      isTradingApiEnabled(chainId) && 
      (rest.enabled !== false) &&
      // Ensure tokenInChainId is not defaulted to 1 (must match active chain)
      chainId !== undefined &&
      chainId !== TradingApiEnum.ChainId._1 // Prevent hardcoded chainId=1 calls
  
  return useQuery<TradingApi.GetSwappableTokensResponse>({
    queryKey,
    queryFn: shouldEnable && params ? swappableTokensQueryFn(params) : skipToken,
    enabled: shouldEnable,
    // Disable refetch on window focus for on-chain-only chains
    refetchOnWindowFocus: isOnChainOnly ? false : rest.refetchOnWindowFocus,
    // In order for `getSwappableTokensQueryData` to be more likely to have cached data,
    // we set the `gcTime` to the longest possible time.
    gcTime: MAX_REACT_QUERY_CACHE_TIME_MS,
    ...rest,
  })
}

// Synchronous way of reading the cached data for this query.
// It will return `undefined` if the data is not cached.
export function getSwappableTokensQueryData({
  queryClient,
  params,
}: {
  queryClient: QueryClient
  params: SwappableTokensParams
}): TradingApi.GetSwappableTokensResponse | undefined {
  return queryClient.getQueryData(swappableTokensQueryKey(params))
}

export function usePrefetchSwappableTokens(input: Maybe<TradeableAsset>, disableTradingApi?: boolean): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (disableTradingApi) {
      return
    }

    const prefetchSwappableTokens = async (): Promise<void> => {
      // Gate Trading API for on-chain-only chains
      if (!input?.chainId) {
        return
      }
      
      const isOnChainOnly = isOnChainOnlyChain(input.chainId)
      if (isOnChainOnly || !isTradingApiEnabled(input.chainId)) {
        // Debug log when prefetch is prevented
        if (isOnChainDebug(input.chainId)) {
          logger.debug('usePrefetchSwappableTokens', 'usePrefetchSwappableTokens', '[TRADING-API] Prevented swappable_tokens prefetch', {
            chainId: input.chainId,
            tokenAddress: input.address,
            reason: isOnChainOnly ? 'on-chain-only chain' : 'Trading API not enabled',
            callSite: 'usePrefetchSwappableTokens',
          })
        }
        return
      }

      const tokenIn = input?.address ? getTokenAddressFromChainForTradingApi(input.address, input.chainId) : undefined
      const tokenInChainId = toTradingApiSupportedChainId(input?.chainId)
      // Ensure we have a valid chainId (not undefined, not on-chain-only, not defaulted to 1)
      if (!tokenIn || !tokenInChainId || tokenInChainId === TradingApiEnum.ChainId._1) {
        if (isOnChainDebug(input.chainId)) {
          logger.debug('usePrefetchSwappableTokens', 'usePrefetchSwappableTokens', '[TRADING-API] Prevented prefetch - invalid params', {
            chainId: input.chainId,
            tokenIn,
            tokenInChainId,
            reason: !tokenIn ? 'no token address' : !tokenInChainId ? 'no chainId' : 'tokenInChainId defaulted to 1',
          })
        }
        return
      }

      await queryClient.prefetchQuery({
        queryKey: swappableTokensQueryKey({
          tokenIn,
          tokenInChainId,
        }),
        queryFn: swappableTokensQueryFn({
          tokenIn,
          tokenInChainId,
        }),
        // In order for `getSwappableTokensQueryData` to be more likely to have cached data,
        // we set the `gcTime` to the longest possible time.
        gcTime: MAX_REACT_QUERY_CACHE_TIME_MS,
      })
    }

    prefetchSwappableTokens().catch((e) => {
      logger.error(e, {
        tags: { file: 'useTradingApiSwappableTokensQuery', function: 'prefetchSwappableTokens' },
      })
    })
  }, [disableTradingApi, input, queryClient])
}

const swappableTokensQueryKey = (params?: SwappableTokensParams): QueryKey => {
  return [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.swappableTokens, params]
}

const swappableTokensQueryFn = (
  params: SwappableTokensParams,
): QueryFunction<TradingApi.GetSwappableTokensResponse, QueryKey, never> | undefined => {
  return async (): ReturnType<typeof TradingApiClient.fetchSwappableTokens> =>
    await TradingApiClient.fetchSwappableTokens(params)
}
