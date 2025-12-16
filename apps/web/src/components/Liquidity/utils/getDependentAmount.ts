import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { Pair } from '@uniswap/v2-sdk'
import { Pool as V3Pool, Position as V3Position } from '@uniswap/v3-sdk'
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk'
import { PositionField } from 'types/position'

export function getDependentAmountFromV2Pair({
  independentAmount,
  otherAmount,
  pair,
  exactField,
  token0,
  token1,
  dependentToken,
}: {
  independentAmount?: CurrencyAmount<Currency>
  otherAmount?: CurrencyAmount<Currency>
  pair?: Pair
  exactField: PositionField
  token0: Maybe<Currency>
  token1: Maybe<Currency>
  dependentToken: Maybe<Currency>
}): CurrencyAmount<Currency> | undefined {
  const [token0Wrapped, token1Wrapped] = [token0?.wrapped, token1?.wrapped]
  if (!token0Wrapped || !token1Wrapped || !independentAmount || !pair) {
    return undefined
  }

  try {
    const dependentTokenAmount =
      exactField === PositionField.TOKEN0
        ? pair.priceOf(token0Wrapped).quote(independentAmount.wrapped)
        : pair.priceOf(token1Wrapped).quote(independentAmount.wrapped)

    return dependentToken
      ? dependentToken.isNative
        ? CurrencyAmount.fromRawAmount(dependentToken, dependentTokenAmount.quotient)
        : dependentTokenAmount
      : undefined
  } catch {
    // in some cases there can be an initialized pool but there is no liquidity in which case
    // the user can enter whatever they want for the dependent amount and that pool will be created
    return otherAmount
  }
}

export function getDependentAmountFromV3Position({
  independentAmount,
  pool,
  tickLower,
  tickUpper,
}: {
  independentAmount: CurrencyAmount<Currency>
  pool: V3Pool
  tickLower: number
  tickUpper: number
}): CurrencyAmount<Currency> {
  const wrappedIndependentAmount = independentAmount.wrapped
  const independentTokenIsFirstToken = wrappedIndependentAmount.currency.equals(pool.token0)

  // Dev-only: log Position calculation inputs
  if (process.env.NODE_ENV !== 'production') {
    console.log('[getDependentAmountFromV3Position] Position calculation', {
      independentAmount: {
        raw: independentAmount.quotient.toString(),
        human: independentAmount.toExact(),
        currency: independentAmount.currency.symbol,
        address: independentAmount.currency.address,
        decimals: independentAmount.currency.decimals,
      },
      pool: {
        token0: pool.token0.address,
        token1: pool.token1.address,
        fee: pool.fee,
        sqrtPriceX96: pool.sqrtRatioX96.toString(),
        tickCurrent: pool.tickCurrent,
        liquidity: pool.liquidity.toString(),
      },
      tickLower,
      tickUpper,
      independentTokenIsFirstToken,
      method: independentTokenIsFirstToken ? 'fromAmount0' : 'fromAmount1',
    })
  }

  let position: V3Position
  let dependentAmount: CurrencyAmount<Currency>

  if (independentTokenIsFirstToken) {
    position = V3Position.fromAmount0({
      pool,
      tickLower,
      tickUpper,
      amount0: wrappedIndependentAmount.quotient,
      useFullPrecision: true,
    })
    dependentAmount = position.amount1
  } else {
    position = V3Position.fromAmount1({
      pool,
      tickLower,
      tickUpper,
      amount1: wrappedIndependentAmount.quotient,
    })
    dependentAmount = position.amount0
  }

  // Dev-only: log Position calculation results
  if (process.env.NODE_ENV !== 'production') {
    console.log('[getDependentAmountFromV3Position] Position calculation result', {
      position: {
        amount0: {
          raw: position.amount0.quotient.toString(),
          human: position.amount0.toExact(),
          currency: position.amount0.currency.symbol,
        },
        amount1: {
          raw: position.amount1.quotient.toString(),
          human: position.amount1.toExact(),
          currency: position.amount1.currency.symbol,
        },
        liquidity: position.liquidity.toString(),
      },
      dependentAmount: {
        raw: dependentAmount.quotient.toString(),
        human: dependentAmount.toExact(),
        currency: dependentAmount.currency.symbol,
        address: dependentAmount.currency.address,
        decimals: dependentAmount.currency.decimals,
      },
    })
  }

  return dependentAmount
}

export function getDependentAmountFromV4Position({
  independentAmount,
  pool,
  tickLower,
  tickUpper,
}: {
  independentAmount: CurrencyAmount<Currency>
  pool: V4Pool
  tickLower: number
  tickUpper: number
}): CurrencyAmount<Currency> {
  const independentTokenIsFirstToken = independentAmount.currency.equals(pool.token0)

  if (independentTokenIsFirstToken) {
    return V4Position.fromAmount0({
      pool,
      tickLower,
      tickUpper,
      amount0: independentAmount.quotient,
      useFullPrecision: true,
    }).amount1
  }

  return V4Position.fromAmount1({
    pool,
    tickLower,
    tickUpper,
    amount1: independentAmount.quotient,
  }).amount0
}
