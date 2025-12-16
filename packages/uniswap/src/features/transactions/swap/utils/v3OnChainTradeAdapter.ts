/**
 * V3 On-Chain Trade Adapter
 *
 * Converts on-chain V3 quotes into a format compatible with the existing trade system.
 * This allows on-chain quotes to work seamlessly with existing swap UI components.
 */

import { Currency, CurrencyAmount, Percent, Price, TradeType } from '@uniswap/sdk-core'
import { FeeAmount, Pool, Route } from '@uniswap/v3-sdk'
import { TradingApi } from '@universe/api'

/**
 * Creates a trade-like object from on-chain V3 quote data
 * This is a simplified trade that works with single-pool V3 swaps
 */
export interface V3OnChainTradeData {
  inputAmount: CurrencyAmount<Currency>
  outputAmount: CurrencyAmount<Currency>
  executionPrice: Price<Currency, Currency>
  priceImpact: Percent | undefined
  pool: Pool
  route: Route<Currency, Currency>
  fee: FeeAmount
  txPayload: {
    to: string
    data: string
    value: string
  }
}

/**
 * Creates a minimal ClassicQuoteResponse-like object for compatibility
 * This allows the on-chain quote to work with existing trade processing
 */
export function createOnChainQuoteResponse(
  data: V3OnChainTradeData,
  slippageTolerance: Percent,
): {
  quote: {
    routing: TradingApi.Routing.CLASSIC
    quote: {
      routing: TradingApi.Routing.CLASSIC
      method: 'v3_onchain'
      amount: string
      amountDecimals: string
      quote: {
        amount: string
        amountDecimals: string
        quoteId?: string
        requestId?: string
        slippageTolerance: number
        route: Array<{
          type: 'v3-pool'
          address: string
          tokenIn: string
          tokenOut: string
          fee: string
          amountIn: string
          amountOut: string
        }>
      }
    }
  }
  txPayload: {
    to: string
    data: string
    value: string
  }
} {
  const { inputAmount, outputAmount, pool, route, fee } = data

  return {
    quote: {
      routing: TradingApi.Routing.CLASSIC,
      quote: {
        routing: TradingApi.Routing.CLASSIC,
        method: 'v3_onchain',
        amount: inputAmount.quotient.toString(),
        amountDecimals: inputAmount.toExact(),
        quote: {
          amount: outputAmount.quotient.toString(),
          amountDecimals: outputAmount.toExact(),
          slippageTolerance: Number(slippageTolerance.toFixed(2)),
          route: [
            {
              type: 'v3-pool',
              address: pool.token0.address,
              tokenIn: inputAmount.currency.wrapped.address,
              tokenOut: outputAmount.currency.wrapped.address,
              fee: fee.toString(),
              amountIn: inputAmount.quotient.toString(),
              amountOut: outputAmount.quotient.toString(),
            },
          ],
        },
      },
    },
    txPayload: data.txPayload,
  }
}

/**
 * Creates a trade-like object that can be used in place of ClassicTrade
 * This is a simplified version for single-pool swaps
 */
export function createV3OnChainTradeLike(
  data: V3OnChainTradeData,
  tradeType: TradeType,
  slippageTolerance: Percent,
): {
  inputAmount: CurrencyAmount<Currency>
  outputAmount: CurrencyAmount<Currency>
  executionPrice: Price<Currency, Currency>
  priceImpact: Percent | undefined
  route: Route<Currency, Currency>
  pool: Pool
  fee: FeeAmount
  txPayload: {
    to: string
    data: string
    value: string
  }
  // Trade-like properties
  tradeType: TradeType
  slippageTolerance: Percent
  minimumAmountOut: (slippageTolerance: Percent) => CurrencyAmount<Currency>
  maximumAmountIn: (slippageTolerance: Percent) => CurrencyAmount<Currency>
} {
  const { inputAmount, outputAmount, executionPrice, priceImpact, route, pool, fee, txPayload } = data

  return {
    inputAmount,
    outputAmount,
    executionPrice,
    priceImpact,
    route,
    pool,
    fee,
    txPayload,
    tradeType,
    slippageTolerance,
    minimumAmountOut: (slippage: Percent) => {
      // complement() = (1 - slippage), which is exactly what we need
      return outputAmount.multiply(slippage.complement())
    },
    maximumAmountIn: (slippage: Percent) => {
      // For maximum amount in, we add slippage: (1 + slippage)
      const ONE = new Percent(1, 1)
      return inputAmount.multiply(ONE.add(slippage))
    },
  }
}

/**
 * Helper to determine if we should use on-chain quotes
 * For now, only for Base Sepolia single-pool V3 swaps
 *
 * TODO: Add feature flag support:
 * ```typescript
 * import { useFeatureFlag } from '@universe/gating'
 * const v3OnChainEnabled = useFeatureFlag(FeatureFlags.V3OnChainEnabled)
 * if (!v3OnChainEnabled) return false
 * ```
 */
export function shouldUseV3OnChainQuote({
  chainId,
  tokenIn,
  tokenOut,
  amountIn,
  featureFlagEnabled = true, // Default to true for Base Sepolia
}: {
  chainId?: number
  tokenIn?: Currency
  tokenOut?: Currency
  amountIn?: CurrencyAmount<Currency>
  featureFlagEnabled?: boolean
}): boolean {
  // Check feature flag (if implemented)
  if (!featureFlagEnabled) {
    return false
  }

  // Only for Base Sepolia (84532) for now
  // TODO: Expand to other chains as needed
  if (chainId !== 84532) {
    return false
  }

  // Must have valid inputs
  if (!tokenIn || !tokenOut || !amountIn) {
    return false
  }

  // Only for ERC20 tokens (not native for now, though it could work)
  if (tokenIn.isNative || tokenOut.isNative) {
    return false
  }

  // Must have a valid amount
  if (amountIn.quotient.toString() === '0') {
    return false
  }

  return true
}
