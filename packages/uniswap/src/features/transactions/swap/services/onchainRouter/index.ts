/**
 * On-Chain Router Service
 * 
 * Main entry point for the on-chain routing system.
 * Exports all public functions and types.
 */

export { getCarbonCounterpartToken, clearCounterpartTokenCache } from './getCounterpartToken'
export { generateCandidateRoutes, type CandidateRoute, type RouteHop } from './generateCandidateRoutes'
export { validateRouteWithQuoter, type ValidatedRoute } from './validateRouteWithQuoter'
export { chooseBestRoute, compareRoutes } from './chooseBestRoute'
export { buildSwapTx, calculateAmountOutMinimum, getDeadline, type SwapTransactionPayload } from './buildSwapTx'
export { findRoute, type RouteResult } from './findRoute'
export { isOnChainRouterEnabled, ONCHAIN_ROUTER_ENABLED_CHAINS } from './config'

