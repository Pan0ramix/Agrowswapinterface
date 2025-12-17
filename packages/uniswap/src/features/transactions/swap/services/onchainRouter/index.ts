/**
 * On-Chain Router Service
 *
 * Main entry point for the on-chain routing system.
 * Exports all public functions and types.
 */

export {
  type BuildSwapTxError,
  type BuildSwapTxErrorCode,
  type BuildSwapTxResult,
  buildSwapTx,
  buildSwapTxStrict,
  calculateAmountOutMinimum,
  getDeadline,
  getDeadlineSecondsFromNow,
  type InvalidSlippageTxBuildError,
  type RouteResult,
  type SwapTransactionPayload,
} from './buildSwapTx'
export { chooseBestRoute, compareRoutes } from './chooseBestRoute'
export { isOnChainRouterEnabled, ONCHAIN_ROUTER_ENABLED_CHAINS } from './config'
export { findRoute, type RouteResult } from './findRoute'
export { type CandidateRoute, generateCandidateRoutes, type RouteHop } from './generateCandidateRoutes'
export { clearCounterpartTokenCache, getCarbonCounterpartToken } from './getCounterpartToken'
export { type ValidatedRoute, validateRouteWithQuoter } from './validateRouteWithQuoter'
