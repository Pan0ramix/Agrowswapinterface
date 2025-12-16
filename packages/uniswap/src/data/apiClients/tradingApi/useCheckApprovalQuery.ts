import { skipToken, type UseQueryResult } from '@tanstack/react-query'
import {
  type TradingApi,
  type UseQueryWithImmediateGarbageCollectionApiHelperHookArgs,
  useQueryWithImmediateGarbageCollection,
} from '@universe/api'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export function useCheckApprovalQuery({
  params,
  ...rest
}: UseQueryWithImmediateGarbageCollectionApiHelperHookArgs<
  TradingApi.ApprovalRequest,
  TradingApi.ApprovalResponse
>): UseQueryResult<TradingApi.ApprovalResponse> {
  const queryKey = [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.approval, params]

  // Skip Trading API approval check for on-chain-only chains (use on-chain allowance reads instead)
  const chainId = params?.chainId
  const isOnChainOnly = chainId != null ? isOnChainOnlyChain(chainId) : false

  return useQueryWithImmediateGarbageCollection<TradingApi.ApprovalResponse>({
    queryKey,
    queryFn:
      params && !isOnChainOnly
        ? async (): ReturnType<typeof TradingApiClient.fetchCheckApproval> =>
            await TradingApiClient.fetchCheckApproval(params)
        : skipToken,
    enabled: rest.enabled !== false && !isOnChainOnly && !!params,
    ...rest,
  })
}
