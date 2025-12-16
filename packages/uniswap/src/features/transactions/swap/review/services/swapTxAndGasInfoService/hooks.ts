import type { UseQueryResult } from '@tanstack/react-query'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { GasStrategy, TradingApi } from '@universe/api'
import { SharedQueryClient } from '@universe/api/src/clients/base/SharedQueryClient'
import { DynamicConfigs, SwapConfigKey, useDynamicConfigValue } from '@universe/gating'
import { useMemo } from 'react'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { useUniswapContext } from 'uniswap/src/contexts/UniswapContext'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import type { SwapDelegationInfo } from 'uniswap/src/features/smartWallet/delegation/types'
import { useAllTransactionSettings } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { useV4SwapEnabled } from 'uniswap/src/features/transactions/swap/hooks/useV4SwapEnabled'
import type { ApprovalTxInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import { useTokenApprovalInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import { createBridgeSwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/bridge/bridgeSwapTxAndGasInfoService'
import { createChainedActionSwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/chained/chainedActionTxSwapAndGasInfoService'
import { createClassicSwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/classic/classicSwapTxAndGasInfoService'
import { FALLBACK_SWAP_REQUEST_POLL_INTERVAL_MS } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/constants'
import { createEVMSwapInstructionsService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/evmSwapInstructionsService'
import { usePresignPermit } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/hooks'
import { createDecorateSwapTxInfoServiceWithEVMLogging } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/logging'
import { createSolanaSwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/svm/solanaSwapTxAndGasInfoService'
import type {
  RoutingServicesMap,
  SwapTxAndGasInfoParameters,
  SwapTxAndGasInfoService,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/swapTxAndGasInfoService'
import { createSwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/swapTxAndGasInfoService'
import { createUniswapXSwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/uniswapx/uniswapXSwapTxAndGasInfoService'
import { createWrapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/wrap/wrapTxAndGasInfoService'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import {
  useSwapFormStore,
  useSwapFormStoreDerivedSwapInfo,
} from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { SwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import type { Trade } from 'uniswap/src/features/transactions/swap/types/trade'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { CurrencyField } from 'uniswap/src/types/currency'
import { logger } from 'utilities/src/logger/logger'
import { useEvent, usePrevious } from 'utilities/src/react/hooks'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'
import type { QueryOptionsResult } from 'utilities/src/reactQuery/queryOptions'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'

type SwapQueryParams = Optional<SwapTxAndGasInfoParameters, 'trade'>

const EMPTY_SWAP_TX_AND_GAS_INFO: SwapTxAndGasInfo = {
  routing: TradingApi.Routing.CLASSIC,
  txRequests: undefined,
  approveTxRequest: undefined,
  revocationTxRequest: undefined,
  gasFee: { isLoading: false, error: null },
  gasFeeEstimation: {},
  trade: undefined,
  permit: undefined,
  swapRequestArgs: undefined,
  unsigned: false,
  includesDelegation: false,
} satisfies SwapTxAndGasInfo

// TODO(swap arch): replace with swap config service
function useSwapConfig(): {
  v4SwapEnabled: boolean
  gasStrategy: GasStrategy
  getCanBatchTransactions?: (chainId: UniverseChainId | undefined) => boolean
  getSwapDelegationInfo?: (chainId: UniverseChainId | undefined) => SwapDelegationInfo
} {
  const chainId = useSwapFormStoreDerivedSwapInfo((s) => s.chainId)
  const gasStrategy = useActiveGasStrategy(chainId, 'general')
  const v4SwapEnabled = useV4SwapEnabled(chainId)
  const { getCanBatchTransactions, getSwapDelegationInfo } = useUniswapContext()
  return useMemo(
    () => ({
      v4SwapEnabled,
      gasStrategy,
      getCanBatchTransactions,
      getSwapDelegationInfo,
    }),
    [v4SwapEnabled, gasStrategy, getCanBatchTransactions, getSwapDelegationInfo],
  )
}

export function useSwapTxAndGasInfoService(): SwapTxAndGasInfoService {
  const swapConfig = useSwapConfig()
  const presignPermit = usePresignPermit()
  const trace = useTrace()
  const transactionSettings = useAllTransactionSettings()
  const instructionService = useMemo(() => {
    return createEVMSwapInstructionsService({
      ...swapConfig,
      presignPermit,
    })
  }, [swapConfig, presignPermit])

  const decorateWithEVMLogging = useEvent(createDecorateSwapTxInfoServiceWithEVMLogging({ trace, transactionSettings }))

  const classicSwapTxInfoService = useMemo(() => {
    const classicService = createClassicSwapTxAndGasInfoService({
      ...swapConfig,
      transactionSettings,
      instructionService,
    })
    return decorateWithEVMLogging(classicService)
  }, [swapConfig, transactionSettings, instructionService, decorateWithEVMLogging])

  const bridgeSwapTxInfoService = useMemo(() => {
    const bridgeService = createBridgeSwapTxAndGasInfoService({
      ...swapConfig,
      transactionSettings,
      instructionService,
    })
    return decorateWithEVMLogging(bridgeService)
  }, [swapConfig, transactionSettings, instructionService, decorateWithEVMLogging])

  const uniswapXSwapTxInfoService = useMemo(() => {
    return createUniswapXSwapTxAndGasInfoService()
  }, [])

  const chainedSwapTxInfoService = useMemo(() => {
    const chainedService = createChainedActionSwapTxAndGasInfoService()
    return chainedService
  }, [])

  const wrapTxInfoService = useMemo(() => {
    const wrapService = createWrapTxAndGasInfoService({ ...swapConfig, transactionSettings, instructionService })
    return decorateWithEVMLogging(wrapService)
  }, [swapConfig, transactionSettings, instructionService, decorateWithEVMLogging])

  const solanaSwapTxInfoService = useMemo(() => {
    return createSolanaSwapTxAndGasInfoService()
  }, [])

  const services = useMemo(() => {
    return {
      [TradingApi.Routing.CLASSIC]: classicSwapTxInfoService,
      [TradingApi.Routing.BRIDGE]: bridgeSwapTxInfoService,
      [TradingApi.Routing.PRIORITY]: uniswapXSwapTxInfoService,
      [TradingApi.Routing.DUTCH_V2]: uniswapXSwapTxInfoService,
      [TradingApi.Routing.DUTCH_V3]: uniswapXSwapTxInfoService,
      [TradingApi.Routing.WRAP]: wrapTxInfoService,
      [TradingApi.Routing.UNWRAP]: wrapTxInfoService,
      [TradingApi.Routing.CHAINED]: chainedSwapTxInfoService,
      [TradingApi.Routing.LIMIT_ORDER]: createNoopService(),
      [TradingApi.Routing.DUTCH_LIMIT]: createNoopService(),
      [TradingApi.Routing.JUPITER]: solanaSwapTxInfoService,
    } satisfies RoutingServicesMap
  }, [
    classicSwapTxInfoService,
    bridgeSwapTxInfoService,
    uniswapXSwapTxInfoService,
    chainedSwapTxInfoService,
    wrapTxInfoService,
    solanaSwapTxInfoService,
  ])

  return useMemo(() => {
    return createSwapTxAndGasInfoService({ services })
  }, [services])
}

function createNoopService<T extends Trade>(): SwapTxAndGasInfoService<T> {
  return {
    getSwapTxAndGasInfo: async (): Promise<SwapTxAndGasInfo> => {
      throw new Error('Not implemented')
    },
  }
}

type SwapQueryKeyParams =
  | {
      requestId: string
      approvalTxInfo: ApprovalTxInfo
    }
  | {
      inputCurrencyId?: string
      outputCurrencyId?: string
      inputAmount?: string
      outputAmount?: string
      hasOnChainQuote?: boolean
    }

// TODO(WEB-7243): Simplify query key logic once all routing types have a corresponding trade this query can be decoupled from derivedSwapInfo
function parseQueryKeyParams(params: SwapQueryParams): SwapQueryKeyParams {
  const { trade, derivedSwapInfo } = params
  const requestId = trade?.quote.requestId
  const hasOnChainQuote = !!derivedSwapInfo.onChainQuote

  // If a trade is not defined or does not have a requestId, supply information about the currencies and amounts
  // to use as a placeholder key params. This keeps the query key stable even for local/on-chain routes.
  // For on-chain quotes, include onChainQuote in the key to ensure the query runs when it's available
  if (!trade || !requestId) {
    const { input, output } = derivedSwapInfo.currencies
    const amounts = derivedSwapInfo.currencyAmounts
    const inputAmount = amounts[CurrencyField.INPUT]?.toExact()
    const outputAmount = amounts[CurrencyField.OUTPUT]?.toExact()

    return {
      inputCurrencyId: input?.currencyId,
      outputCurrencyId: output?.currencyId,
      inputAmount,
      outputAmount,
      hasOnChainQuote, // Include in key to trigger query when onChainQuote becomes available
    }
  }

  return {
    requestId,
    approvalTxInfo: params.approvalTxInfo,
  }
}

/**
 * Returns true if the params have updated in such a way that the previous query result should be used as placeholder data while fetching the new result,
 * rather than showing a brief loading state in the UX.
 */
function getCanUsePlaceholderData(params: SwapQueryParams, prevParams?: SwapQueryParams): boolean {
  if (prevParams?.trade && params.trade) {
    const approvalUnchanged =
      prevParams.approvalTxInfo.tokenApprovalInfo.action === params.approvalTxInfo.tokenApprovalInfo.action
    const tradeInputUnchanged =
      (prevParams.trade.tradeType === params.trade.tradeType &&
        prevParams.trade.inputAmount.equalTo(params.trade.inputAmount)) ||
      prevParams.trade.outputAmount.equalTo(params.trade.outputAmount)

    return approvalUnchanged && tradeInputUnchanged
  }

  return false
}

function createGetQueryOptions(ctx: {
  swapTxAndGasInfoService: SwapTxAndGasInfoService<Trade>
  refetchInterval?: number
}) {
  return function getQueryOptions(
    params: SwapQueryParams,
  ): QueryOptionsResult<
    SwapTxAndGasInfo | null,
    Error,
    SwapTxAndGasInfo | null,
    [ReactQueryCacheKey.SwapTxAndGasInfo, SwapQueryKeyParams]
  > {
    const { trade, derivedSwapInfo } = params
    const chainId = derivedSwapInfo.chainId
    const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
    const hasOnChainQuote = !!derivedSwapInfo.onChainQuote

    // For on-chain-only chains, allow query if either:
    // 1. trade.quote exists (Trading API quote), OR
    // 2. onChainQuote exists (on-chain quote)
    // This allows the service to build transaction requests from on-chain quotes
    // IMPORTANT: For on-chain-only chains, we need to allow the query to run even if trade is missing
    // as long as onChainQuote exists, because the trade is built from onChainQuote
    const shouldDisableOnChainOnly = isOnChainOnly && trade && !trade.quote && !hasOnChainQuote

    // For on-chain-only chains, enable query if we have onChainQuote OR trade
    // This ensures the query runs when onChainQuote is available, even if trade hasn't been built yet
    const enabled = isOnChainOnly
      ? (!!trade || hasOnChainQuote) && !shouldDisableOnChainOnly
      : !!trade && !shouldDisableOnChainOnly

    // Always log for Base Sepolia to debug the issue
    if (chainId === 84532) {
      // Use console.log as a fallback to ensure we see this
      console.log('[QUERY-OPTIONS] Base Sepolia query options', {
        chainId,
        isOnChainOnly,
        hasTrade: !!trade,
        hasTradeQuote: !!trade?.quote,
        hasOnChainQuote,
        shouldDisableOnChainOnly,
        enabled,
        onChainQuoteKeys: derivedSwapInfo.onChainQuote ? Object.keys(derivedSwapInfo.onChainQuote) : [],
        onChainQuoteHasTxPayload: !!derivedSwapInfo.onChainQuote?.txPayload,
        onChainQuoteTxPayloadTo: derivedSwapInfo.onChainQuote?.txPayload.to,
      })
      logger.debug(
        'createGetQueryOptions',
        'createGetQueryOptions',
        '[QUERY-OPTIONS] Query options for swapTxAndGasInfo',
        {
          chainId,
          isOnChainOnly,
          hasTrade: !!trade,
          hasTradeQuote: !!trade?.quote,
          hasOnChainQuote,
          shouldDisableOnChainOnly,
          enabled,
          onChainQuoteKeys: derivedSwapInfo.onChainQuote ? Object.keys(derivedSwapInfo.onChainQuote) : [],
          onChainQuoteHasTxPayload: !!derivedSwapInfo.onChainQuote?.txPayload,
        },
      )
    }

    return queryOptions({
      queryKey: [ReactQueryCacheKey.SwapTxAndGasInfo, parseQueryKeyParams(params), hasOnChainQuote ? 'onchain' : 'api'],
      queryFn: async () => {
        // For on-chain-only chains, allow query to run if onChainQuote exists, even if trade is missing
        // The trade will be built from onChainQuote in the service
        if (!trade && !hasOnChainQuote) {
          if (chainId === 84532) {
            console.log('[QUERY-FN] Skipping query - no trade and no onChainQuote', {
              chainId,
              hasTrade: !!trade,
              hasOnChainQuote,
            })
            logger.debug(
              'swapTxAndGasInfoQuery',
              'queryFn',
              '[QUERY-FN] Skipping query - no trade and no onChainQuote',
              {
                chainId,
                hasTrade: !!trade,
                hasOnChainQuote,
              },
            )
          }
          return null
        }

        // Always log entry to queryFn for Base Sepolia
        if (chainId === 84532) {
          console.log('[QUERY-FN] Query function called', {
            chainId,
            hasTrade: !!trade,
            hasOnChainQuote,
            onChainQuoteHasTxPayload: !!params.derivedSwapInfo.onChainQuote?.txPayload,
          })
        }
        try {
          if (chainId === 84532) {
            console.log('[QUERY-FN] Executing getSwapTxAndGasInfo', {
              chainId,
              hasOnChainQuote,
              hasTrade: !!trade,
              hasTradeQuote: !!trade?.quote,
              onChainQuoteHasTxPayload: !!params.derivedSwapInfo.onChainQuote?.txPayload,
            })
            logger.debug('swapTxAndGasInfoQuery', 'queryFn', '[QUERY-FN] Executing getSwapTxAndGasInfo', {
              chainId,
              hasOnChainQuote,
              hasTrade: !!trade,
              hasTradeQuote: !!trade?.quote,
              onChainQuoteHasTxPayload: !!params.derivedSwapInfo.onChainQuote?.txPayload,
            })
          }
          return await ctx.swapTxAndGasInfoService.getSwapTxAndGasInfo({ ...params, trade })
        } catch (error) {
          if (chainId === 84532) {
            logger.error(error, {
              tags: { file: 'swapTxAndGasInfoService', function: 'getSwapTxAndGasInfo' },
              extra: {
                chainId,
                hasOnChainQuote,
                hasTradeQuote: !!trade?.quote,
                error: error instanceof Error ? error.message : String(error),
              },
            })
          }
          throw error
        }
      },
      refetchInterval: ctx.refetchInterval,
      enabled,
    })
  }
}

export function useSwapParams(): {
  approvalTxInfo: ApprovalTxInfo
  derivedSwapInfo: DerivedSwapInfo
  trade: Trade | undefined
} {
  const derivedSwapInfo = useSwapFormStore((s) => s.derivedSwapInfo)

  const account = useWallet().evmAccount

  const {
    chainId,
    wrapType,
    currencyAmounts,
    trade: { trade },
  } = derivedSwapInfo

  // Get router address for on-chain-only chains to pass to approval check
  const routerAddress = useMemo(() => {
    if (isOnChainOnlyChain(chainId) && chainId === 84532) {
      return getAgroswapSwapRouterAddress(chainId)
    }
    return undefined
  }, [chainId])

  const approvalTxInfo = useTokenApprovalInfo({
    account,
    chainId,
    wrapType,
    currencyInAmount: currencyAmounts[CurrencyField.INPUT],
    currencyOutAmount: currencyAmounts[CurrencyField.OUTPUT],
    routing: trade?.routing,
    routerAddress,
  })

  return {
    approvalTxInfo,
    derivedSwapInfo,
    trade: trade ?? undefined,
  }
}

/**
 * Takes in the trade and then finds the appropriate service to use
 * and to obtain the necessary information tx and gas info.
 */
function useSwapTxAndGasInfoQuery(input: {
  trade: Trade | undefined
  approvalTxInfo: ApprovalTxInfo
  derivedSwapInfo: DerivedSwapInfo
}): UseQueryResult<SwapTxAndGasInfo | null, Error> {
  const swapTxAndGasInfoService = useSwapTxAndGasInfoService()

  const refetchInterval = useDynamicConfigValue({
    config: DynamicConfigs.Swap,
    key: SwapConfigKey.TradingApiSwapRequestMs,
    defaultValue: FALLBACK_SWAP_REQUEST_POLL_INTERVAL_MS,
  })

  const getQueryOptions = useEvent(createGetQueryOptions({ swapTxAndGasInfoService, refetchInterval }))

  const queryOptions = getQueryOptions(input)

  // Debug logging for Base Sepolia - use console.log to ensure visibility
  if (input.derivedSwapInfo.chainId === 84532) {
    console.log('[HOOK] useSwapTxAndGasInfoQuery called', {
      chainId: input.derivedSwapInfo.chainId,
      hasTrade: !!input.trade,
      hasOnChainQuote: !!input.derivedSwapInfo.onChainQuote,
      queryEnabled: queryOptions.enabled,
      queryKey: queryOptions.queryKey[0],
      onChainQuoteHasTxPayload: !!input.derivedSwapInfo.onChainQuote?.txPayload,
    })
    logger.debug('useSwapTxAndGasInfoQuery', 'useSwapTxAndGasInfoQuery', '[HOOK] useSwapTxAndGasInfoQuery called', {
      chainId: input.derivedSwapInfo.chainId,
      hasTrade: !!input.trade,
      hasOnChainQuote: !!input.derivedSwapInfo.onChainQuote,
      queryEnabled: queryOptions.enabled,
      queryKey: queryOptions.queryKey[0],
      onChainQuoteHasTxPayload: !!input.derivedSwapInfo.onChainQuote?.txPayload,
    })
  }

  return useQuery(queryOptions)
}

/**
 * Main hook that manages fetching the swap's tx and gas info once
 * the swap form has valid inputs and other conditions are met.
 */
export function useSwapTxAndGasInfo(): SwapTxAndGasInfo {
  const params = useSwapParams()

  // Debug logging for Base Sepolia
  if (params.derivedSwapInfo.chainId === 84532) {
    console.log('[HOOK-ENTRY] useSwapTxAndGasInfo called', {
      chainId: params.derivedSwapInfo.chainId,
      hasTrade: !!params.trade,
      hasOnChainQuote: !!params.derivedSwapInfo.onChainQuote,
      onChainQuoteHasTxPayload: !!params.derivedSwapInfo.onChainQuote?.txPayload,
    })
  }

  const { data } = useSwapTxAndGasInfoQuery(params)

  const prevData = usePrevious(data)
  const prevParams = usePrevious(params)

  // Persist prev query result as placeholder data when applicable
  const canUsePlaceholderData = useMemo(() => getCanUsePlaceholderData(params, prevParams), [params, prevParams])
  const placeholderData = canUsePlaceholderData ? prevData : undefined

  return data ?? placeholderData ?? EMPTY_SWAP_TX_AND_GAS_INFO
}

export async function ensureFreshSwapTxData(
  params: { trade: Trade; approvalTxInfo: ApprovalTxInfo; derivedSwapInfo: DerivedSwapInfo },
  swapTxAndGasInfoService: SwapTxAndGasInfoService,
): Promise<SwapTxAndGasInfo> {
  const getQueryOptions = createGetQueryOptions({ swapTxAndGasInfoService })

  // If data is already cached and fresh, this returns immediately.
  // If data is stale or being fetched, this waits for the fetch to complete.
  const freshData = await SharedQueryClient.fetchQuery(getQueryOptions(params))

  if (!freshData) {
    throw new Error('Empty response returned when trying to ensure fresh SwapTxData')
  }

  return freshData
}
