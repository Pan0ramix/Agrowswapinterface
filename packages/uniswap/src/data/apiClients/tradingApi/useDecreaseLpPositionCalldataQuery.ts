import { skipToken, type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { TradingApi, UseQueryApiHelperHookArgs } from '@universe/api'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { getTradeSettingsDeadline } from 'uniswap/src/data/apiClients/tradingApi/utils/getTradeSettingsDeadline'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export function useDecreaseLpPositionCalldataQuery({
  params,
  deadlineInMinutes,
  ...rest
}: UseQueryApiHelperHookArgs<TradingApi.DecreaseLPPositionRequest, TradingApi.DecreaseLPPositionResponse> & {
  deadlineInMinutes: number | undefined
}): UseQueryResult<TradingApi.DecreaseLPPositionResponse> {
  const queryKey = [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.decreaseLp, params]

  // AGROSWAP: Disable Trading API for on-chain-only chains (e.g., Base Sepolia)
  // These chains should use on-chain methods (buildDecreaseLiquidityTx) instead
  const isOnChainOnly = params?.chainId ? isOnChainOnlyChain(params.chainId) : false

  if (process.env.NODE_ENV !== 'production' && isOnChainOnly && params?.chainId) {
    console.log(
      `[AGROSWAP] useDecreaseLpPositionCalldataQuery: Disabled for on-chain-only chain ${params.chainId}. Trading API will not be called.`,
    )
  }

  const deadline = getTradeSettingsDeadline(deadlineInMinutes)
  const paramsWithDeadline = { ...params, deadline }

  return useQuery<TradingApi.DecreaseLPPositionResponse>({
    queryKey,
    queryFn: isOnChainOnly
      ? skipToken
      : async () => {
          if (!params) {
            throw { name: 'Params are required' }
          }

          // AGROSWAP: Guardrail - double-check we're not calling Trading API for on-chain-only chains
          if (isOnChainOnlyChain(params.chainId)) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn(
                `[AGROSWAP] useDecreaseLpPositionCalldataQuery: Attempted Trading API call for on-chain-only chain ${params.chainId}. This should be disabled.`,
              )
            }
            throw new Error(`Trading API not available for on-chain-only chain ${params.chainId}`)
          }

          return await TradingApiClient.decreaseLpPosition(paramsWithDeadline)
        },
    enabled: !isOnChainOnly && rest.enabled !== false && !!params,
    ...rest,
  })
}
