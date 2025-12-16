/**
 * Best Route Selection
 *
 * Chooses the route with the highest output amount from validated routes.
 * For Carbon-to-Carbon routes, prioritizes by tier (1 > 2 > 3) when amounts are similar.
 */

import { ValidatedRoute } from 'uniswap/src/features/transactions/swap/services/onchainRouter/validateRouteWithQuoter'

/**
 * Choose the best route from validated routes
 *
 * Selection criteria:
 * 1. Highest amountOut (primary)
 * 2. For Carbon-to-Carbon routes, prefer lower tier when amounts are within 0.1%
 * 3. Lower gas estimate when amounts are equal
 */
export function chooseBestRoute(validatedRoutes: ValidatedRoute[]): ValidatedRoute | null {
  if (validatedRoutes.length === 0) {
    return null
  }

  if (validatedRoutes.length === 1) {
    return validatedRoutes[0]
  }

  // Sort by amountOut (descending)
  const sorted = [...validatedRoutes].sort((a, b) => {
    const amountA = BigInt(a.amountOut)
    const amountB = BigInt(b.amountOut)

    // Primary: Compare by amount
    if (amountA > amountB) {
      return -1
    }
    if (amountA < amountB) {
      return 1
    }

    // Secondary: For Carbon-to-Carbon routes, prefer lower tier when amounts are equal
    const tierA = a.route.tier ?? 999
    const tierB = b.route.tier ?? 999
    if (tierA !== tierB) {
      return tierA - tierB
    }

    // Tertiary: Prefer lower gas estimate
    if (a.gasEstimate && b.gasEstimate) {
      const gasA = BigInt(a.gasEstimate)
      const gasB = BigInt(b.gasEstimate)
      if (gasA < gasB) {
        return -1
      }
      if (gasA > gasB) {
        return 1
      }
    }

    return 0
  })

  const bestRoute = sorted[0]

  // For Carbon-to-Carbon routes, check if a lower tier route is within 0.1% of best
  if (bestRoute.route.tier && bestRoute.route.tier > 1) {
    const bestAmount = BigInt(bestRoute.amountOut)
    const threshold = (bestAmount * BigInt(999)) / BigInt(1000) // 99.9% of best

    // Find best route from lower tier that's within threshold
    for (const route of sorted) {
      if (route.route.tier && route.route.tier < bestRoute.route.tier) {
        const routeAmount = BigInt(route.amountOut)
        if (routeAmount >= threshold) {
          // Prefer lower tier if within 0.1%
          return route
        }
      }
    }
  }

  return bestRoute
}

/**
 * Compare two routes and return the better one
 */
export function compareRoutes(routeA: ValidatedRoute, routeB: ValidatedRoute): ValidatedRoute {
  const amountA = BigInt(routeA.amountOut)
  const amountB = BigInt(routeB.amountOut)

  if (amountA > amountB) {
    return routeA
  }
  if (amountA < amountB) {
    return routeB
  }

  // Amounts are equal, prefer lower tier for Carbon routes
  const tierA = routeA.route.tier ?? 999
  const tierB = routeB.route.tier ?? 999
  if (tierA < tierB) {
    return routeA
  }
  if (tierA > tierB) {
    return routeB
  }

  // Prefer lower gas
  if (routeA.gasEstimate && routeB.gasEstimate) {
    const gasA = BigInt(routeA.gasEstimate)
    const gasB = BigInt(routeB.gasEstimate)
    if (gasA < gasB) {
      return routeA
    }
    if (gasA > gasB) {
      return routeB
    }
  }

  // Default to first route
  return routeA
}
