/**
 * GraphQL/Indexer Fees Provider
 *
 * This provider wraps existing GraphQL/Trading API fee data (currently from REST API/GraphQL).
 * When Goldsky is ready, replace the internal query implementation to fetch from Goldsky,
 * keeping the provider interface unchanged.
 *
 * This provider currently uses existing GraphQL/Trading API data source.
 * When Goldsky is ready, replace the internal query implementation to fetch from Goldsky,
 * keep the provider interface unchanged.
 */

import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import type {
  FeeProviderParams,
  FeeProviderResult,
  PositionFees,
} from 'uniswap/src/features/positions/fees/feeProviders'

/**
 * GraphQL/indexer fees provider - estimated fees from GraphQL/Trading API
 *
 * This is a placeholder that wraps positionInfo fee data.
 * In production, this should fetch from the GraphQL API or Goldsky indexer.
 *
 * Currently, this provider expects fee data to be passed via a separate mechanism
 * (e.g., from positionInfo.fee0Amount/fee1Amount), so it returns a failure if no
 * fallback data is available. The resolver hook will handle this appropriately.
 */
export async function graphqlFeesProvider(params: FeeProviderParams): Promise<FeeProviderResult> {
  // This provider currently cannot fetch fees directly - it relies on positionInfo
  // being populated from GraphQL/REST API elsewhere in the application.
  //
  // Future implementation: Query GraphQL API or Goldsky indexer directly here
  //
  // Example future implementation:
  // try {
  //   const fees = await queryGraphQLOrGoldsky(params)
  //   return { ok: true, data: { ...fees, source: 'graphql_indexer', isAuthoritative: false } }
  // } catch (error) {
  //   return { ok: false, reason: error.message, source: 'graphql_indexer' }
  // }

  return {
    ok: false,
    reason: 'GraphQL provider requires positionInfo data (not yet implemented as standalone provider)',
    source: 'graphql_indexer',
  }
}

/**
 * Helper to convert positionInfo fee data to PositionFees format
 * This is used by the resolver when positionInfo has fee data but other providers fail
 */
export function positionInfoToPositionFees(
  fee0Amount: CurrencyAmount<Currency> | undefined,
  fee1Amount: CurrencyAmount<Currency> | undefined,
  token0: Currency,
  token1: Currency,
): PositionFees | null {
  if (!fee0Amount || !fee1Amount) {
    return null
  }

  return {
    amount0: fee0Amount,
    amount1: fee1Amount,
    token0,
    token1,
    source: 'graphql_indexer',
    isAuthoritative: false,
    updatedAt: Date.now(),
  }
}
