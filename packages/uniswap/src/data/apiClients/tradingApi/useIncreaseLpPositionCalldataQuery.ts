import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type TradingApi, type UseQueryApiHelperHookArgs } from '@universe/api'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { getTradeSettingsDeadline } from 'uniswap/src/data/apiClients/tradingApi/utils/getTradeSettingsDeadline'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export function useIncreaseLpPositionCalldataQuery({
  params,
  deadlineInMinutes,
  enabled: restEnabled = true,
  ...rest
}: UseQueryApiHelperHookArgs<TradingApi.IncreaseLPPositionRequest, TradingApi.IncreaseLPPositionResponse> & {
  deadlineInMinutes?: number
}): UseQueryResult<TradingApi.IncreaseLPPositionResponse> {
  const queryKey = [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.increaseLp, params]

  const deadline = getTradeSettingsDeadline(deadlineInMinutes)

  const paramsWithDeadline = { ...params, deadline }
  const tradingApiDisabled = isOnChainRouterEnabled(params?.chainId)
  const enabled = !tradingApiDisabled && restEnabled
  return useQuery<TradingApi.IncreaseLPPositionResponse>({
    queryKey,
    queryFn: async () => {
      if (!params) {
        throw { name: 'Params are required' }
      }
      // Safety: should be gated by enabled; return never for disabled chains.
      if (tradingApiDisabled) {
        return Promise.resolve(undefined as unknown as TradingApi.IncreaseLPPositionResponse)
      }
      return await TradingApiClient.increaseLpPosition(paramsWithDeadline)
    },
    enabled,
    ...rest,
  })
}
