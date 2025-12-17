/**
 * Position Fees - Provider Pattern
 *
 * Unified interface for fetching position fees from multiple sources
 */

export type {
  FeeDataSource,
  FeeProvider,
  FeeProviderParams,
  FeeProviderResult,
  PositionFees,
} from './feeProviders'
export { collectSimulationProvider } from './providers/collectSimulationProvider'
export { graphqlFeesProvider, positionInfoToPositionFees } from './providers/graphqlFeesProvider'
export {
  computeFeeGrowthInsideX128,
  computeFeesOwed,
  onchainMathFeesProvider,
} from './providers/onchainMathFeesProvider'
export { type UsePositionFeesParams, type UsePositionFeesReturn, usePositionFees } from './usePositionFees'
export { type BigintIshSafe, toBigintIshSafe, zeroBigInt } from './utils/bigintish'
export {
  type CurrencyAmountRawInput,
  formatProviderError,
  isIntegerString,
  toCurrencyAmountRaw,
} from './utils/currencyAmountRaw'

