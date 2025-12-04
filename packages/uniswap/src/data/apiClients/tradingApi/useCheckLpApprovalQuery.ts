import { UseQueryResult, useQuery } from '@tanstack/react-query'
import { TradingApi, UseQueryApiHelperHookArgs } from '@universe/api'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'

export function useCheckLpApprovalQuery({
  params,
  headers,
  ...rest
}: UseQueryApiHelperHookArgs<TradingApi.CheckApprovalLPRequest, TradingApi.CheckApprovalLPResponse> & {
  headers?: Record<string, string>
}): UseQueryResult<TradingApi.CheckApprovalLPResponse> {
  const queryKey = [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.lpApproval, params]

  // STEP 5: Completely disable Trading API LP approval on on-chain chains
  // Determine chain ID and check if on-chain router is enabled
  // Extract chainId from params to check if we should skip Trading API
  const chainId = params?.chainId
  const isOnChainEnabled = chainId != null ? isOnChainRouterEnabled(chainId) : false

  return useQuery<TradingApi.CheckApprovalLPResponse>({
    queryKey,
    queryFn: async () => {
      // Never call Trading API when on-chain router is enabled for this chain
      // This must completely eliminate network requests to /v1/lp/approve
      if (isOnChainEnabled) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useCheckLpApprovalQuery] Skipping Trading API approval for on-chain enabled chain', { chainId })
        }
        // Return a safe default that indicates no approval needed (compatible with calling code)
        // Never return undefined from a React Query queryFn – use a safe default object
        // This result should never be used on on-chain chains, but we return it for type safety
        return {
          token0Approval: undefined,
          token1Approval: undefined,
          token0Cancel: undefined,
          token1Cancel: undefined,
          permitData: undefined,
          token0PermitTransaction: undefined,
          token1PermitTransaction: undefined,
          positionTokenApproval: undefined,
          gasFeeToken0Approval: undefined,
          gasFeeToken1Approval: undefined,
          gasFeeToken0Permit: undefined,
          gasFeeToken1Permit: undefined,
        } as TradingApi.CheckApprovalLPResponse
      }

      if (!params) {
        throw { name: 'Params are required' }
      }
      // Only call Trading API when NOT on an on-chain enabled chain
      return await TradingApiClient.checkLpApproval(params, headers)
    },
    // Disable query completely when on-chain router is enabled OR when params are missing
    // This ensures the queryFn is never called on on-chain chains
    enabled: (rest.enabled !== false) && !isOnChainEnabled && !!params,
    ...rest,
  })
}
