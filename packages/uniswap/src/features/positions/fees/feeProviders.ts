/**
 * Fee Provider Interface
 *
 * Provides a unified interface for fetching position fees from multiple sources:
 * - collect() simulation (authoritative on-chain)
 * - on-chain math (estimated using Uniswap V3 fee growth formulas)
 * - GraphQL/indexer (estimated from Trading API or Goldsky)
 *
 * This abstraction allows easy swapping of data sources (e.g., GraphQL → Goldsky)
 * without changing UI code.
 */

import { Currency, CurrencyAmount } from '@uniswap/sdk-core'

/**
 * Data source for position fees
 */
export type FeeDataSource =
  | 'collect_simulation' // Authoritative on-chain collect() simulation
  | 'onchain_math' // Estimated using Uniswap V3 fee growth on-chain math
  | 'graphql_indexer' // Estimated from GraphQL/Trading API/Goldsky indexer
  | 'none' // No data available

/**
 * Position fees data structure
 */
export type PositionFees = {
  amount0: CurrencyAmount<Currency>
  amount1: CurrencyAmount<Currency>
  token0: Currency
  token1: Currency
  source: FeeDataSource
  isAuthoritative: boolean
  updatedAt: number // Timestamp in milliseconds
}

/**
 * Result from a fee provider
 */
export type FeeProviderResult = { ok: true; data: PositionFees } | { ok: false; reason: string; source: FeeDataSource }

/**
 * Parameters for fee provider functions
 */
export type FeeProviderParams = {
  chainId: number
  tokenId: string | number
  account?: string
  positionManagerAddress: string
}

/**
 * Fee provider function signature
 * Providers should never throw; return { ok: false } on failure
 */
export type FeeProvider = (params: FeeProviderParams) => Promise<FeeProviderResult> | FeeProviderResult

