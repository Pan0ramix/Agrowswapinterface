import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { TradeWithStatus } from 'uniswap/src/features/transactions/swap/types/trade'
import { BaseDerivedInfo } from 'uniswap/src/features/transactions/types/baseDerivedInfo'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { CurrencyField } from 'uniswap/src/types/currency'

/**
 * On-chain quote data structure (matches useOnChainSwapQuote return type)
 */
export type OnChainQuoteData = {
  quoteAmountIn?: CurrencyAmount<Currency> // For exact output
  quoteAmountOut?: CurrencyAmount<Currency> // For exact input
  route: any // Route result from findRoute
  priceImpact?: number
  txPayload: {
    to: string
    data: string
    value: string
    gasLimit?: string
  }
  amountInMaximum?: CurrencyAmount<Currency> // For exact output
  amountOutMinimum?: CurrencyAmount<Currency> // For exact input
}

export type DerivedSwapInfo<
  TInput = CurrencyInfo,
  TOutput extends CurrencyInfo = CurrencyInfo,
> = BaseDerivedInfo<TInput> & {
  chainId: UniverseChainId
  currencies: BaseDerivedInfo<TInput>['currencies'] & {
    [CurrencyField.OUTPUT]: Maybe<TOutput>
  }
  currencyAmounts: BaseDerivedInfo<TInput>['currencyAmounts'] & {
    [CurrencyField.OUTPUT]: Maybe<CurrencyAmount<Currency>>
  }
  currencyAmountsUSDValue: {
    [CurrencyField.INPUT]: Maybe<CurrencyAmount<Currency>>
    [CurrencyField.OUTPUT]: Maybe<CurrencyAmount<Currency>>
  }
  currencyBalances: BaseDerivedInfo<TInput>['currencyBalances'] & {
    [CurrencyField.OUTPUT]: Maybe<CurrencyAmount<Currency>>
  }
  outputAmountUserWillReceive: Maybe<CurrencyAmount<Currency>>
  focusOnCurrencyField: CurrencyField | null
  trade: TradeWithStatus
  wrapType: WrapType
  selectingCurrencyField?: CurrencyField
  txId?: string
  /**
   * On-chain quote data for transaction building (on-chain-only chains)
   * This is populated when useOnChainQuote is enabled and a quote is successfully fetched
   */
  onChainQuote?: OnChainQuoteData
}
