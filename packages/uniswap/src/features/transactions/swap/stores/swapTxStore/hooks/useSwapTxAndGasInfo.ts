import { TradingApi } from '@universe/api'
import { useMemo, useRef } from 'react'
import { logger } from 'utilities/src/logger/logger'
import { useTokenApprovalInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import { getUniswapXSwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/uniswapx/utils'
import {
  getBridgeSwapTxAndGasInfo,
  getClassicSwapTxAndGasInfo,
  getFallbackSwapTxAndGasInfo,
  getWrapTxAndGasInfo,
  usePermitTxInfo,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/utils'
import { useTransactionRequestInfo } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/useTransactionRequestInfo'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type { SwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { AccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { CurrencyField } from 'uniswap/src/types/currency'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'

/** @deprecated Delete when ServiceBasedSwapTransactionInfo is fully rolled out */
export function useSwapTxAndGasInfo({
  derivedSwapInfo,
  account,
}: {
  derivedSwapInfo: DerivedSwapInfo
  account?: AccountDetails
}): SwapTxAndGasInfo {
  const {
    chainId,
    wrapType,
    currencyAmounts,
    trade: tradeState,
  } = derivedSwapInfo
  const trade = tradeState?.trade

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
  const { tokenApprovalInfo } = approvalTxInfo

  // TODO(MOB-3425) decouple wrap tx from swap tx to simplify UniswapX code
  const swapTxInfo = useTransactionRequestInfo({
    derivedSwapInfo,
    tokenApprovalInfo,
  })

  // Hook probe: before usePermitTxInfo
  // CRITICAL: useRef must be called unconditionally at the top, before any conditional logic
  const hookProbeTXH04 = useRef(0)
  hookProbeTXH04.current += 1 // Always increment, even in production (no-op if not logged)
  if (process.env.NODE_ENV !== 'production') {
    // Use deduped logging for HookProbe
    logger.debugDeduped(
      'useSwapTxAndGasInfo',
      'useSwapTxAndGasInfo',
      '[HookProbe] TX-H04: before usePermitTxInfo',
      {
        chainId,
        hasTrade: !!trade,
        hasQuote: !!trade?.quote,
      },
      {
        ttlMs: 15000,
        minIntervalMs: 3000,
        keyParts: ['TX-H04', chainId, !!trade, !!trade?.quote],
      }
    )
  }

  const permitTxInfo = usePermitTxInfo({ quote: trade?.quote })

  // Hook probe: after usePermitTxInfo
  // CRITICAL: useRef must be called unconditionally
  const hookProbeTXH05 = useRef(0)
  hookProbeTXH05.current += 1 // Always increment, even in production (no-op if not logged)
  if (process.env.NODE_ENV !== 'production') {
    // Use deduped logging for HookProbe
    logger.debugDeduped(
      'useSwapTxAndGasInfo',
      'useSwapTxAndGasInfo',
      '[HookProbe] TX-H05: after usePermitTxInfo',
      {
        chainId,
        hasPermitTxRequest: !!permitTxInfo.permitTxRequest,
      },
      {
        ttlMs: 15000,
        minIntervalMs: 3000,
        keyParts: ['TX-H05', chainId, !!permitTxInfo.permitTxRequest],
      }
    )
  }

  const normalizedTrade =
    trade && !trade.routing && isOnChainOnlyChain(chainId)
      ? (Object.assign({}, trade, { routing: TradingApi.Routing.CLASSIC }) as typeof trade)
      : trade

  switch (normalizedTrade?.routing) {
    case TradingApi.Routing.DUTCH_V2:
    case TradingApi.Routing.DUTCH_V3:
    case TradingApi.Routing.PRIORITY:
      return getUniswapXSwapTxAndGasInfo({ trade: normalizedTrade, swapTxInfo, approvalTxInfo })
    case TradingApi.Routing.BRIDGE:
      return getBridgeSwapTxAndGasInfo({ trade: normalizedTrade, swapTxInfo, approvalTxInfo })
    case TradingApi.Routing.CLASSIC:
      return getClassicSwapTxAndGasInfo({
        trade: normalizedTrade,
        swapTxInfo,
        approvalTxInfo,
        permitTxInfo,
      })
    case TradingApi.Routing.WRAP:
    case TradingApi.Routing.UNWRAP:
      return getWrapTxAndGasInfo({ trade: normalizedTrade, swapTxInfo })
    default:
      return getFallbackSwapTxAndGasInfo({ trade: normalizedTrade, swapTxInfo, approvalTxInfo })
  }
}
