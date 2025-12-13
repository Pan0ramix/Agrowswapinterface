import { type QueryFunction, type QueryKey, skipToken, type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type TradingApi, type UseQueryApiHelperHookArgs } from '@universe/api'
import { uniswapUrls } from 'uniswap/src/constants/urls'
import { checkWalletDelegation } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export type WalletCheckDelegationParams = {
  walletAddresses: TradingApi.WalletCheckDelegationRequestBody['walletAddresses']
  chainIds: TradingApi.WalletCheckDelegationRequestBody['chainIds']
}

export function useWalletCheckDelegationQuery({
  params,
  ...rest
}: UseQueryApiHelperHookArgs<
  WalletCheckDelegationParams,
  TradingApi.WalletCheckDelegationResponseBody
>): UseQueryResult<TradingApi.WalletCheckDelegationResponseBody> {
  // Gate Trading API for on-chain-only chains
  const hasOnChainOnlyChain = params?.chainIds?.some((chainId) => isOnChainOnlyChain(chainId))
  const shouldDisable = hasOnChainOnlyChain || !params

  const queryKey = walletCheckDelegationQueryKey(params)

  return useQuery<TradingApi.WalletCheckDelegationResponseBody>({
    queryKey,
    queryFn: shouldDisable ? skipToken : (params ? walletCheckDelegationQueryFn(params) : skipToken),
    enabled: !shouldDisable && (rest.enabled !== false),
    ...rest,
  })
}

const walletCheckDelegationQueryKey = (params?: WalletCheckDelegationParams): QueryKey => {
  return [ReactQueryCacheKey.TradingApi, uniswapUrls.tradingApiPaths.wallet.checkDelegation, params]
}

const walletCheckDelegationQueryFn = (
  params: WalletCheckDelegationParams,
): QueryFunction<TradingApi.WalletCheckDelegationResponseBody, QueryKey, never> | undefined => {
  return async (): ReturnType<typeof checkWalletDelegation> => await checkWalletDelegation(params)
}
