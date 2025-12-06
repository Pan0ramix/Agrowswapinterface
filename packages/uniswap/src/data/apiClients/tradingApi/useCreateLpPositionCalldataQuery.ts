import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { TradingApi, UseQueryApiHelperHookArgs } from '@universe/api'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { getTradeSettingsDeadline } from 'uniswap/src/data/apiClients/tradingApi/utils/getTradeSettingsDeadline'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export function useCreateLpPositionCalldataQuery({
  params,
  deadlineInMinutes,
  enabled: restEnabled = true,
  ...rest
}: UseQueryApiHelperHookArgs<TradingApi.CreateLPPositionRequest, TradingApi.CreateLPPositionResponse> & {
  deadlineInMinutes?: number
}): UseQueryResult<TradingApi.CreateLPPositionResponse> {
  const queryKey = [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.createLp, params]
  const deadline = getTradeSettingsDeadline(deadlineInMinutes)
  const paramsWithDeadline = { ...params, deadline }
  const tradingApiDisabled = isOnChainRouterEnabled(params?.chainId)
  const enabled = !tradingApiDisabled && restEnabled

  return useQuery<TradingApi.CreateLPPositionResponse>({
    queryKey,
    queryFn: async () => {
      if (!params) {
        throw { name: 'Params are required' }
      }
      // Safety: should be gated by enabled; return never for disabled chains.
      if (tradingApiDisabled) {
        return Promise.resolve(undefined as unknown as TradingApi.CreateLPPositionResponse)
      }
      return await TradingApiClient.createLpPosition(paramsWithDeadline)
    },
    enabled,
    ...rest,
  })
}
