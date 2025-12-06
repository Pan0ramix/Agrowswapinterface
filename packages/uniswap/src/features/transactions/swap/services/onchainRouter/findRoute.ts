/**
 * Main Route Finding Orchestrator
 * 
 * Orchestrates the full routing flow:
 * 1. Generate candidate routes
 * 2. Validate routes with QuoterV2
 * 3. Choose best route
 */

import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { PublicClient } from 'viem'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { generateCandidateRoutes, CandidateRoute } from './generateCandidateRoutes'
import { validateRouteWithQuoter, ValidatedRoute } from './validateRouteWithQuoter'
import { chooseBestRoute } from './chooseBestRoute'
import { logger } from 'utilities/src/logger/logger'

/**
 * Complete route result
 */
export interface RouteResult {
  route: ValidatedRoute
  amountIn: CurrencyAmount<Currency>
  amountOut: CurrencyAmount<Currency>
  priceImpact?: number // Percentage price impact
}

/**
 * Find the best route for a swap
 * 
 * @param tokenIn - Input token
 * @param tokenOut - Output token
 * @param amountIn - Input amount
 * @param chainId - Chain ID
 * @param publicClient - Viem public client
 * @param fees - Fee tiers to try (default: [500, 3000, 10000])
 * @returns Best route result or null if no route found
 */
export async function findRoute(
  tokenIn: Currency,
  tokenOut: Currency,
  amountIn: CurrencyAmount<Currency>,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  fees: FeeAmount[] = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH],
): Promise<RouteResult | null> {
  try {
    // Step 1: Generate candidate routes
    const candidateRoutes = await generateCandidateRoutes(
      tokenIn,
      tokenOut,
      chainId,
      publicClient,
      fees as any,
    )

    if (candidateRoutes.length === 0) {
      logger.warn('findRoute', 'findRoute', 'No candidate routes generated', {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        chainId,
      })
      return null
    }

    // Step 2: Validate routes with QuoterV2 (in parallel for performance)
    const validationPromises = candidateRoutes.map((route) =>
      validateRouteWithQuoter(route, amountIn, tokenOut, chainId, publicClient),
    )

    const validatedRoutes = (await Promise.all(validationPromises)).filter(
      (route): route is ValidatedRoute => route !== null,
    )

    if (validatedRoutes.length === 0) {
      logger.warn('findRoute', 'findRoute', 'No valid routes after validation; attempting direct fallback', {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        chainId,
        candidateCount: candidateRoutes.length,
        feesTried: fees,
      })
      // Fallback: explicitly try a direct single-hop route across provided fee tiers.
      // This covers cases where candidate generation or multi-hop construction misses a valid direct pool.
      for (const fee of fees) {
        const directRoute: CandidateRoute = {
          hops: [
            {
              tokenIn: tokenIn.wrapped,
              tokenOut: tokenOut.wrapped,
              fee,
            },
          ],
          description: `Fallback direct: ${tokenIn.symbol} → ${tokenOut.symbol} (fee ${fee})`,
        }

        const validated = await validateRouteWithQuoter(directRoute, amountIn, tokenOut, chainId, publicClient)
        if (validated) {
          logger.info('findRoute', 'findRoute', 'Direct fallback route succeeded', {
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            chainId,
            fee,
            amountIn: amountIn.toExact(),
            amountOut: validated.amountOutCurrency.toExact(),
          })
          return {
            route: validated,
            amountIn,
            amountOut: validated.amountOutCurrency,
          }
        }
      }

      logger.warn('findRoute', 'findRoute', 'No valid routes found after validation', {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        chainId,
        candidateCount: candidateRoutes.length,
      })
      return null
    }

    // Step 3: Choose best route
    const bestRoute = chooseBestRoute(validatedRoutes)

    if (!bestRoute) {
      return null
    }

    // Step 4: Calculate price impact (optional, for informational purposes)
    // Price impact = (expected - actual) / expected * 100
    // For now, we'll skip this calculation as it requires additional data

    return {
      route: bestRoute,
      amountIn,
      amountOut: bestRoute.amountOutCurrency,
    }
  } catch (error) {
    logger.error(error, {
      tags: {
        file: 'findRoute',
        function: 'findRoute',
      },
      extra: {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        chainId,
      },
    })
    return null
  }
}

/**
 * Check if on-chain router should be enabled for a chain
 * @deprecated Use isOnChainRouterEnabled from './config' instead
 */
export function isOnChainRouterEnabled(chainId: number): boolean {
  // Re-export from config to maintain backward compatibility
  const { isOnChainRouterEnabled: checkEnabled } = require('./config')
  return checkEnabled(chainId)
}

