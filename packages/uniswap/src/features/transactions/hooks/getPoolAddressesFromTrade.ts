/**
 * Helper to extract pool addresses from a trade route
 * For multi-hop swaps, extracts all V3 pool addresses from the route
 */

import { Token } from '@uniswap/sdk-core'
import { computePoolAddress, FeeAmount, Pool, Route as V3Route } from '@uniswap/v3-sdk'
import { AGROSWAP_V3_CORE_FACTORY_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { ClassicTrade } from 'uniswap/src/features/transactions/swap/types/trade'
import { Address } from 'viem'

/**
 * Extract all V3 pool addresses from a ClassicTrade route
 */
export function getPoolAddressesFromTrade(
  trade: ClassicTrade | null | undefined,
  chainId: EVMUniverseChainId | undefined,
): Address[] {
  if (!trade || !chainId) {
    return []
  }

  const poolAddresses: Address[] = []

  // Extract from V3 routes
  if (trade.swaps) {
    for (const swap of trade.swaps) {
      if (swap.route instanceof V3Route) {
        for (const pool of swap.route.pools) {
          if (pool instanceof Pool) {
            // Pool has an address property
            const poolAddress =
              (pool as any).token0?.address && (pool as any).token1?.address
                ? computePoolAddressFromPool(pool as Pool, chainId)
                : undefined
            if (poolAddress && !poolAddresses.includes(poolAddress)) {
              poolAddresses.push(poolAddress)
            }
          }
        }
      }
    }
  }

  // Fallback: try to extract from routev3 if available
  if ((trade as any).routev3) {
    const routev3 = (trade as any).routev3 as V3Route<Token, Token>
    for (const pool of routev3.pools) {
      const poolAddress = computePoolAddressFromPool(pool, chainId)
      if (poolAddress && !poolAddresses.includes(poolAddress)) {
        poolAddresses.push(poolAddress)
      }
    }
  }

  return poolAddresses
}

/**
 * Compute pool address from a Pool instance
 */
function computePoolAddressFromPool(pool: Pool, chainId: EVMUniverseChainId): Address | undefined {
  try {
    const factoryAddresses = AGROSWAP_V3_CORE_FACTORY_ADDRESSES
    const factoryAddress = factoryAddresses[chainId as keyof typeof factoryAddresses] as string | undefined

    if (!factoryAddress) {
      return undefined
    }

    const token0 = pool.token0
    const token1 = pool.token1
    const fee = pool.fee as FeeAmount

    const [tokenA, tokenB] = token0.sortsBefore(token1) ? [token0, token1] : [token1, token0]

    return computePoolAddress({
      factoryAddress,
      tokenA,
      tokenB,
      fee,
      chainId: chainId as number,
    }) as Address
  } catch {
    return undefined
  }
}
