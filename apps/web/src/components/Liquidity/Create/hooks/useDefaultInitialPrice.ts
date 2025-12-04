import { Currency, CurrencyAmount, Price, TradeType } from '@uniswap/sdk-core'
import JSBI from 'jsbi'
import { useEffect, useMemo, useState } from 'react'
import { PositionField } from 'types/position'
import { PollingInterval } from 'uniswap/src/constants/misc'
import { useTrade } from 'uniswap/src/features/transactions/swap/hooks/useTrade'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { FeeAmount } from '@uniswap/v3-sdk'

export function useDefaultInitialPrice({
  currencies,
  skip,
}: {
  currencies: {
    [PositionField.TOKEN0]?: Maybe<Currency>
    [PositionField.TOKEN1]?: Maybe<Currency>
  }
  skip?: boolean
}) {
  const [price, setPrice] = useState<Price<Currency, Currency> | undefined>()
  const currencyIn = currencies[PositionField.TOKEN0]
  const currencyOut = currencies[PositionField.TOKEN1]
  const chainId = currencyIn?.chainId as EVMUniverseChainId | undefined

  // Check if on-chain router is enabled for this chain
  const isOnChainRouterChain = useMemo(() => {
    return chainId ? isOnChainRouterEnabled(chainId) : false
  }, [chainId])

  // For on-chain router chains, fetch price from pool directly instead of Trading API
  const [onChainPrice, setOnChainPrice] = useState<Price<Currency, Currency> | undefined>()
  const [onChainPriceLoading, setOnChainPriceLoading] = useState(false)

  useEffect(() => {
    // Reset price when currencyIn or currencyOut changes
    setPrice(undefined)
    setOnChainPrice(undefined)
  }, [currencyIn, currencyOut])

  // Fetch price from on-chain pool for on-chain router chains
  useEffect(() => {
    if (!isOnChainRouterChain || !currencyIn || !currencyOut || skip || !!price || !!onChainPrice) {
      return
    }

    // Try to fetch pool state for common fee tiers
    const fetchPoolPrice = async () => {
      setOnChainPriceLoading(true)
      try {
        const publicClient = createViemClient(chainId!)
        const feeTiers: FeeAmount[] = [FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH]
        
        for (const fee of feeTiers) {
          const poolState = await fetchV3PoolState({
            tokenIn: currencyIn,
            tokenOut: currencyOut,
            fee,
            chainId: chainId!,
            publicClient,
          })

          if (poolState?.pool) {
            // Pool exists and is initialized - use its price
            const poolPrice = poolState.pool.token0Price
            // Ensure price direction matches currency order
            const isTokenInToken0 = currencyIn.wrapped.sortsBefore(currencyOut.wrapped)
            const finalPrice = isTokenInToken0 ? poolPrice : poolPrice.invert()
            setOnChainPrice(finalPrice)
            setOnChainPriceLoading(false)
            return
          }
        }

        // No pool found - leave price undefined (user can input manually)
        setOnChainPriceLoading(false)
      } catch (error) {
        // Pool fetch failed - leave price undefined
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[useDefaultInitialPrice] Failed to fetch on-chain pool price:', error)
        }
        setOnChainPriceLoading(false)
      }
    }

    fetchPoolPrice()
  }, [isOnChainRouterChain, currencyIn, currencyOut, chainId, skip, price, onChainPrice])

  const amountSpecified = useMemo(() => {
    if (!currencyIn) {
      return undefined
    }

    return CurrencyAmount.fromRawAmount(currencyIn, JSBI.BigInt(10 ** currencyIn.decimals))
  }, [currencyIn])

  // Skip Trading API trade query for on-chain router chains
  const shouldSkipTradeQuery = isOnChainRouterChain || !amountSpecified || !currencyOut || !!price || skip

  const { trade, isLoading: tradeLoading } = useTrade({
    amountSpecified,
    otherCurrency: currencyOut,
    tradeType: TradeType.EXACT_INPUT,
    pollInterval: PollingInterval.Slow,
    skip: shouldSkipTradeQuery,
  })

  useEffect(() => {
    // For on-chain router chains, use on-chain price if available
    if (isOnChainRouterChain && onChainPrice) {
      setPrice(onChainPrice)
      return
    }

    // For non-on-chain chains, use Trading API trade price
    if (trade?.outputAmount && currencyIn && currencyOut) {
      setPrice(new Price(currencyIn, currencyOut, trade.inputAmount.quotient, trade.outputAmount.quotient))
    }
  }, [trade, currencyIn, currencyOut, isOnChainRouterChain, onChainPrice])

  const isLoading = isOnChainRouterChain ? onChainPriceLoading : tradeLoading

  return { isLoading, price }
}
