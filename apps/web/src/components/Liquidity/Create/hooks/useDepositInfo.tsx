import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'
import { Pair } from '@uniswap/v2-sdk'
import { encodeSqrtRatioX96, FeeAmount, priceToClosestTick, TickMath, Pool as V3Pool } from '@uniswap/v3-sdk'
import { Pool as V4Pool } from '@uniswap/v4-sdk'
import { useNativeTokenPercentageBufferExperiment } from 'components/Liquidity/Create/hooks/useNativeTokenPercentageBufferExperiment'
import { DepositInfo } from 'components/Liquidity/types'
import {
  getDependentAmountFromV2Pair,
  getDependentAmountFromV3Position,
  getDependentAmountFromV4Position,
} from 'components/Liquidity/utils/getDependentAmount'
import JSBI from 'jsbi'
import tryParseCurrencyAmount from 'lib/utils/tryParseCurrencyAmount'
import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { PositionField } from 'types/position'
import { useMaxAmountSpend } from 'uniswap/src/features/gas/hooks/useMaxAmountSpend'
import { applyNativeTokenPercentageBuffer } from 'uniswap/src/features/gas/utils'
import { useOnChainCurrencyBalance } from 'uniswap/src/features/portfolio/api'
import { useUSDCValue } from 'uniswap/src/features/transactions/hooks/useUSDCPrice'

type UseDepositInfoProps = {
  protocolVersion: ProtocolVersion
  poolOrPair?: V3Pool | V4Pool | Pair | undefined
  address?: string
  token0?: Maybe<Currency>
  token1?: Maybe<Currency>
  tickLower?: number
  tickUpper?: number
  exactField: PositionField
  exactAmounts: {
    [field in PositionField]?: string
  }
  skipDependentAmount?: boolean
  feeAmount?: FeeAmount // For V3: needed to create mock pool when poolOrPair is undefined
  price?: Price<Currency, Currency> // For V3: price to use when creating mock pool (matches upstream useV3DerivedMintInfo)
}

export function useTokenBalanceWithBuffer(currencyBalance: Maybe<CurrencyAmount<Currency>>, bufferPercentage: number) {
  return useMemo(() => {
    if (!currencyBalance) {
      return undefined
    }

    return applyNativeTokenPercentageBuffer(currencyBalance, bufferPercentage)
  }, [currencyBalance, bufferPercentage])
}

export function useDepositInfo(state: UseDepositInfoProps): DepositInfo {
  const bufferPercentage = useNativeTokenPercentageBufferExperiment()
  const { protocolVersion, address, token0, token1, exactField, exactAmounts } = state

  const { balance: token0Balance } = useOnChainCurrencyBalance(token0, address)
  const { balance: token1Balance } = useOnChainCurrencyBalance(token1, address)

  const token0BalanceWithBuffer = useTokenBalanceWithBuffer(token0Balance, bufferPercentage)
  const token1BalanceWithBuffer = useTokenBalanceWithBuffer(token1Balance, bufferPercentage)

  const token0MaxAmount = useMaxAmountSpend({ currencyAmount: token0BalanceWithBuffer })
  const token1MaxAmount = useMaxAmountSpend({ currencyAmount: token1BalanceWithBuffer })

  const [independentToken, dependentToken] = exactField === PositionField.TOKEN0 ? [token0, token1] : [token1, token0]
  const independentAmount = tryParseCurrencyAmount(exactAmounts[exactField], independentToken)
  const otherAmount = tryParseCurrencyAmount(
    exactAmounts[exactField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0],
    dependentToken,
  )

  // Dev-only: log parsed amounts after user input
  if (process.env.NODE_ENV !== 'production') {
    console.log('[useDepositInfo] Parsed amounts from user input', {
      exactField,
      independentToken: independentToken
        ? {
            address: independentToken.address,
            symbol: independentToken.symbol,
            decimals: independentToken.decimals,
          }
        : undefined,
      dependentToken: dependentToken
        ? {
            address: dependentToken.address,
            symbol: dependentToken.symbol,
            decimals: dependentToken.decimals,
          }
        : undefined,
      independentAmountInput: exactAmounts[exactField],
      independentAmount: independentAmount
        ? {
            raw: independentAmount.quotient.toString(),
            human: independentAmount.toExact(),
            currency: independentAmount.currency.symbol,
            decimals: independentAmount.currency.decimals,
          }
        : undefined,
      otherAmountInput: exactAmounts[exactField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0],
      otherAmount: otherAmount
        ? {
            raw: otherAmount.quotient.toString(),
            human: otherAmount.toExact(),
            currency: otherAmount.currency.symbol,
            decimals: otherAmount.currency.decimals,
          }
        : undefined,
    })
  }

  const dependentAmount: CurrencyAmount<Currency> | undefined | null = useMemo(() => {
    const shouldSkip = state.skipDependentAmount || protocolVersion === ProtocolVersion.UNSPECIFIED
    if (shouldSkip) {
      return dependentToken && CurrencyAmount.fromRawAmount(dependentToken, 0)
    }

    if (protocolVersion === ProtocolVersion.V2) {
      return getDependentAmountFromV2Pair({
        independentAmount,
        otherAmount,
        pair: state.poolOrPair as Pair,
        exactField,
        token0,
        token1,
        dependentToken,
      })
    }

    const { tickLower, tickUpper } = state
    if (tickLower === undefined || tickUpper === undefined || !independentAmount) {
      return undefined
    }

    // For V3: Create mock pool if poolOrPair is undefined (new pool scenario)
    // This matches upstream Uniswap's behavior in useV3DerivedMintInfo (lines 232-240)
    let poolForPosition: V3Pool | V4Pool | undefined = state.poolOrPair as V3Pool | V4Pool | undefined

    if (
      protocolVersion === ProtocolVersion.V3 &&
      !poolForPosition &&
      state.feeAmount &&
      token0 &&
      token1 &&
      state.price
    ) {
      // Match upstream logic exactly: use price from context (derived from initialPrice or pool price)
      // Same as useV3DerivedMintInfo (lines 232-240): mockPool creation requires price, feeAmount, and tokens
      const token0Wrapped = token0.wrapped
      const token1Wrapped = token1.wrapped
      // Ensure tokens are sorted (tokenA < tokenB by address) - same as upstream useV3DerivedMintInfo
      const tokenA = token0Wrapped.sortsBefore(token1Wrapped) ? token0Wrapped : token1Wrapped
      const tokenB = token0Wrapped.sortsBefore(token1Wrapped) ? token1Wrapped : token0Wrapped

      // Wrap price to match sorted token order (same as createMockV3Pool in priceRangeInfo.ts lines 138-143)
      // This ensures the price's base/quote currencies match the pool's token0/token1 order
      const wrappedPrice = new Price(tokenA, tokenB, state.price.denominator, state.price.numerator)

      // Check for invalid price (same validation as upstream useV3DerivedMintInfo lines 218-229)
      const sqrtRatioX96 = encodeSqrtRatioX96(wrappedPrice.numerator, wrappedPrice.denominator)
      const invalidPrice = !(
        JSBI.greaterThanOrEqual(sqrtRatioX96, TickMath.MIN_SQRT_RATIO) &&
        JSBI.lessThan(sqrtRatioX96, TickMath.MAX_SQRT_RATIO)
      )

      // Create mock pool using EXACT same logic as upstream useV3DerivedMintInfo (lines 232-240)
      if (!invalidPrice) {
        const currentTick = priceToClosestTick(wrappedPrice)
        const currentSqrt = TickMath.getSqrtRatioAtTick(currentTick)
        poolForPosition = new V3Pool(tokenA, tokenB, state.feeAmount, currentSqrt, JSBI.BigInt(0), currentTick, [])
      }
    }

    if (!poolForPosition) {
      return undefined
    }

    const dependentTokenAmount =
      protocolVersion === ProtocolVersion.V3
        ? getDependentAmountFromV3Position({
            independentAmount,
            pool: poolForPosition as V3Pool,
            tickLower,
            tickUpper,
          })
        : getDependentAmountFromV4Position({
            independentAmount,
            pool: poolForPosition as V4Pool,
            tickLower,
            tickUpper,
          })

    // Dev-only: log dependent amount calculation
    if (process.env.NODE_ENV !== 'production') {
      console.log('[useDepositInfo] Dependent amount calculation', {
        protocolVersion,
        hasPool: !!state.poolOrPair,
        poolForPosition: poolForPosition
          ? {
              token0: poolForPosition.token0.address,
              token1: poolForPosition.token1.address,
              fee: (poolForPosition as V3Pool).fee,
              sqrtPriceX96: (poolForPosition as V3Pool).sqrtRatioX96.toString(),
              tickCurrent: (poolForPosition as V3Pool).tickCurrent,
            }
          : undefined,
        independentAmount: independentAmount
          ? {
              raw: independentAmount.quotient.toString(),
              human: independentAmount.toExact(),
              currency: independentAmount.currency.symbol,
              address: independentAmount.currency.address,
            }
          : undefined,
        tickLower,
        tickUpper,
        dependentTokenAmount: dependentTokenAmount
          ? {
              raw: dependentTokenAmount.quotient.toString(),
              human: dependentTokenAmount.toExact(),
              currency: dependentTokenAmount.currency.symbol,
              address: dependentTokenAmount.currency.address,
            }
          : undefined,
        dependentToken: dependentToken
          ? {
              symbol: dependentToken.symbol,
              address: dependentToken.address,
              decimals: dependentToken.decimals,
            }
          : undefined,
      })
    }

    return dependentToken && CurrencyAmount.fromRawAmount(dependentToken, dependentTokenAmount.quotient)
  }, [state, protocolVersion, independentAmount, otherAmount, dependentToken, exactField, token0, token1])

  const independentTokenUSDValue = useUSDCValue(independentAmount)
  const dependentTokenUSDValue = useUSDCValue(dependentAmount)

  const dependentField = exactField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0

  const parsedAmounts: { [field in PositionField]: CurrencyAmount<Currency> | undefined | null } = useMemo(() => {
    const result = {
      [PositionField.TOKEN0]: exactField === PositionField.TOKEN0 ? independentAmount : dependentAmount,
      [PositionField.TOKEN1]: exactField === PositionField.TOKEN0 ? dependentAmount : independentAmount,
    }

    // Dev-only: log final parsed amounts mapping
    if (process.env.NODE_ENV !== 'production') {
      console.log('[useDepositInfo] Final parsed amounts mapping', {
        exactField,
        TOKEN0: result[PositionField.TOKEN0]
          ? {
              raw: result[PositionField.TOKEN0]!.quotient.toString(),
              human: result[PositionField.TOKEN0]!.toExact(),
              currency: result[PositionField.TOKEN0]!.currency.symbol,
              address: result[PositionField.TOKEN0]!.currency.address,
              decimals: result[PositionField.TOKEN0]!.currency.decimals,
            }
          : null,
        TOKEN1: result[PositionField.TOKEN1]
          ? {
              raw: result[PositionField.TOKEN1]!.quotient.toString(),
              human: result[PositionField.TOKEN1]!.toExact(),
              currency: result[PositionField.TOKEN1]!.currency.symbol,
              address: result[PositionField.TOKEN1]!.currency.address,
              decimals: result[PositionField.TOKEN1]!.currency.decimals,
            }
          : null,
        mapping: {
          TOKEN0: exactField === PositionField.TOKEN0 ? 'independentAmount' : 'dependentAmount',
          TOKEN1: exactField === PositionField.TOKEN0 ? 'dependentAmount' : 'independentAmount',
        },
      })
    }

    return result
  }, [dependentAmount, independentAmount, exactField])
  const { [PositionField.TOKEN0]: currency0Amount, [PositionField.TOKEN1]: currency1Amount } = parsedAmounts

  const { t } = useTranslation()
  const error = useMemo(() => {
    if (!parsedAmounts[PositionField.TOKEN0] || !parsedAmounts[PositionField.TOKEN1]) {
      return t('common.noAmount.error')
    }

    const insufficientToken0Balance = currency0Amount && token0MaxAmount?.lessThan(currency0Amount)
    const insufficientToken1Balance = currency1Amount && token1MaxAmount?.lessThan(currency1Amount)

    if (insufficientToken0Balance && insufficientToken1Balance) {
      return <Trans i18nKey="common.insufficientBalance.error" />
    }

    if (insufficientToken0Balance) {
      return (
        <Trans
          i18nKey="common.insufficientTokenBalance.error"
          values={{
            tokenSymbol: token0?.symbol,
          }}
        />
      )
    }

    if (insufficientToken1Balance) {
      return (
        <Trans
          i18nKey="common.insufficientTokenBalance.error"
          values={{
            tokenSymbol: token1?.symbol,
          }}
        />
      )
    }

    return undefined
  }, [
    parsedAmounts,
    currency0Amount,
    token0MaxAmount,
    currency1Amount,
    token1MaxAmount,
    t,
    token0?.symbol,
    token1?.symbol,
  ])

  const result = useMemo(
    () => ({
      currencyBalances: { [PositionField.TOKEN0]: token0Balance, [PositionField.TOKEN1]: token1Balance },
      formattedAmounts: { [exactField]: exactAmounts[exactField], [dependentField]: dependentAmount?.toExact() },
      currencyAmounts: { [exactField]: independentAmount, [dependentField]: dependentAmount },
      currencyAmountsUSDValue: { [exactField]: independentTokenUSDValue, [dependentField]: dependentTokenUSDValue },
      error,
    }),
    [
      token0Balance,
      token1Balance,
      exactField,
      exactAmounts,
      dependentField,
      dependentAmount,
      independentAmount,
      independentTokenUSDValue,
      dependentTokenUSDValue,
      error,
    ],
  )

  return result
}
