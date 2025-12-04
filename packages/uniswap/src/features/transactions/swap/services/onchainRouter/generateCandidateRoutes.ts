/**
 * Candidate Route Generation
 * 
 * Generates all possible routing paths for swaps, including Carbon token routing.
 * Supports 4 routing cases:
 * 1. Normal tokens (neither is Carbon)
 * 2. Swapping TO a Carbon token
 * 3. Swapping FROM a Carbon token
 * 4. Carbon-to-Carbon swaps
 */

import { Currency, Token } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { WRAPPED_NATIVE_CURRENCY } from 'uniswap/src/constants/tokens'
import { getCarbonCounterpartToken } from './getCounterpartToken'
import { PublicClient } from 'viem'

/**
 * Represents a single hop in a route
 */
export interface RouteHop {
  tokenIn: Token
  tokenOut: Token
  fee: FeeAmount
}

/**
 * Represents a complete route (can be single or multi-hop)
 */
export interface CandidateRoute {
  hops: RouteHop[]
  description: string
  tier?: number // For Carbon-to-Carbon routes: 1 = preferred, 2 = partial, 3 = fallback
}

/**
 * Get the wrapped native currency (WETH) for a chain
 */
function getWrappedNativeCurrency(chainId: EVMUniverseChainId): Token {
  const wrapped = WRAPPED_NATIVE_CURRENCY[chainId]
  if (!wrapped) {
    throw new Error(`Wrapped native currency not found for chain ${chainId}`)
  }
  return wrapped
}

/**
 * Generate candidate routes for Case 1: Normal tokens (neither is Carbon)
 */
async function generateNormalTokenRoutes(
  tokenIn: Currency,
  tokenOut: Currency,
  fees: FeeAmount[],
): Promise<CandidateRoute[]> {
  const routes: CandidateRoute[] = []
  const tokenInWrapped = tokenIn.wrapped
  const tokenOutWrapped = tokenOut.wrapped

  // Direct pool: tokenIn → tokenOut
  for (const fee of fees) {
    routes.push({
      hops: [
        {
          tokenIn: tokenInWrapped,
          tokenOut: tokenOutWrapped,
          fee,
        },
      ],
      description: `Direct: ${tokenIn.symbol} → ${tokenOut.symbol}`,
    })
  }

  return routes
}

/**
 * Generate candidate routes for Case 2: Swapping TO a Carbon token
 */
async function generateToCarbonRoutes(
  tokenIn: Currency,
  carbonToken: Token,
  counterpartToken: Token,
  weth: Token,
  fees: FeeAmount[],
  chainId: EVMUniverseChainId,
): Promise<CandidateRoute[]> {
  const routes: CandidateRoute[] = []
  const tokenInWrapped = tokenIn.wrapped

  // Primary route: tokenIn → counterpart(CARBON) → CARBON
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      routes.push({
        hops: [
          {
            tokenIn: tokenInWrapped,
            tokenOut: counterpartToken,
            fee: fee1,
          },
          {
            tokenIn: counterpartToken,
            tokenOut: carbonToken,
            fee: fee2,
          },
        ],
        description: `${tokenIn.symbol} → ${counterpartToken.symbol} → ${carbonToken.symbol}`,
      })
    }
  }

  // Fallback route: tokenIn → WETH → counterpart(CARBON) → CARBON
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      for (const fee3 of fees) {
        routes.push({
          hops: [
            {
              tokenIn: tokenInWrapped,
              tokenOut: weth,
              fee: fee1,
            },
            {
              tokenIn: weth,
              tokenOut: counterpartToken,
              fee: fee2,
            },
            {
              tokenIn: counterpartToken,
              tokenOut: carbonToken,
              fee: fee3,
            },
          ],
          description: `${tokenIn.symbol} → WETH → ${counterpartToken.symbol} → ${carbonToken.symbol}`,
        })
      }
    }
  }

  return routes
}

/**
 * Generate candidate routes for Case 3: Swapping FROM a Carbon token
 */
async function generateFromCarbonRoutes(
  carbonToken: Token,
  counterpartToken: Token,
  tokenOut: Currency,
  weth: Token,
  fees: FeeAmount[],
  chainId: EVMUniverseChainId,
): Promise<CandidateRoute[]> {
  const routes: CandidateRoute[] = []
  const tokenOutWrapped = tokenOut.wrapped

  // Primary route: CARBON → counterpart(CARBON) → tokenOut
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      routes.push({
        hops: [
          {
            tokenIn: carbonToken,
            tokenOut: counterpartToken,
            fee: fee1,
          },
          {
            tokenIn: counterpartToken,
            tokenOut: tokenOutWrapped,
            fee: fee2,
          },
        ],
        description: `${carbonToken.symbol} → ${counterpartToken.symbol} → ${tokenOut.symbol}`,
      })
    }
  }

  // Fallback route: CARBON → counterpart(CARBON) → WETH → tokenOut
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      for (const fee3 of fees) {
        routes.push({
          hops: [
            {
              tokenIn: carbonToken,
              tokenOut: counterpartToken,
              fee: fee1,
            },
            {
              tokenIn: counterpartToken,
              tokenOut: weth,
              fee: fee2,
            },
            {
              tokenIn: weth,
              tokenOut: tokenOutWrapped,
              fee: fee3,
            },
          ],
          description: `${carbonToken.symbol} → ${counterpartToken.symbol} → WETH → ${tokenOut.symbol}`,
        })
      }
    }
  }

  return routes
}

/**
 * Generate candidate routes for Case 4: Carbon-to-Carbon swaps
 */
async function generateCarbonToCarbonRoutes(
  carbonTokenA: Token,
  counterpartA: Token,
  carbonTokenB: Token,
  counterpartB: Token,
  weth: Token,
  fees: FeeAmount[],
  chainId: EVMUniverseChainId,
): Promise<CandidateRoute[]> {
  const routes: CandidateRoute[] = []

  // Tier 1: Preferred route - full carbon ecosystem
  // CARBON_A → CounterA → CounterB → CARBON_B
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      for (const fee3 of fees) {
        routes.push({
          hops: [
            {
              tokenIn: carbonTokenA,
              tokenOut: counterpartA,
              fee: fee1,
            },
            {
              tokenIn: counterpartA,
              tokenOut: counterpartB,
              fee: fee2,
            },
            {
              tokenIn: counterpartB,
              tokenOut: carbonTokenB,
              fee: fee3,
            },
          ],
          description: `${carbonTokenA.symbol} → ${counterpartA.symbol} → ${counterpartB.symbol} → ${carbonTokenB.symbol}`,
          tier: 1,
        })
      }
    }
  }

  // Tier 2: Partial carbon route + Uniswap fallback
  // CARBON_A → CounterA → WETH → CounterB → CARBON_B
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      for (const fee3 of fees) {
        for (const fee4 of fees) {
          routes.push({
            hops: [
              {
                tokenIn: carbonTokenA,
                tokenOut: counterpartA,
                fee: fee1,
              },
              {
                tokenIn: counterpartA,
                tokenOut: weth,
                fee: fee2,
              },
              {
                tokenIn: weth,
                tokenOut: counterpartB,
                fee: fee3,
              },
              {
                tokenIn: counterpartB,
                tokenOut: carbonTokenB,
                fee: fee4,
              },
            ],
            description: `${carbonTokenA.symbol} → ${counterpartA.symbol} → WETH → ${counterpartB.symbol} → ${carbonTokenB.symbol}`,
            tier: 2,
          })
        }
      }
    }
  }

  // Tier 3: Full fallback routes
  // Direct pool: CARBON_A → CARBON_B
  for (const fee of fees) {
    routes.push({
      hops: [
        {
          tokenIn: carbonTokenA,
          tokenOut: carbonTokenB,
          fee,
        },
      ],
      description: `Direct: ${carbonTokenA.symbol} → ${carbonTokenB.symbol}`,
      tier: 3,
    })
  }

  // Two-hop via WETH: CARBON_A → WETH → CARBON_B
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      routes.push({
        hops: [
          {
            tokenIn: carbonTokenA,
            tokenOut: weth,
            fee: fee1,
          },
          {
            tokenIn: weth,
            tokenOut: carbonTokenB,
            fee: fee2,
          },
        ],
        description: `${carbonTokenA.symbol} → WETH → ${carbonTokenB.symbol}`,
        tier: 3,
      })
    }
  }

  // Multihop combinations
  // CARBON_A → CounterA → WETH → CARBON_B
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      for (const fee3 of fees) {
        routes.push({
          hops: [
            {
              tokenIn: carbonTokenA,
              tokenOut: counterpartA,
              fee: fee1,
            },
            {
              tokenIn: counterpartA,
              tokenOut: weth,
              fee: fee2,
            },
            {
              tokenIn: weth,
              tokenOut: carbonTokenB,
              fee: fee3,
            },
          ],
          description: `${carbonTokenA.symbol} → ${counterpartA.symbol} → WETH → ${carbonTokenB.symbol}`,
          tier: 3,
        })
      }
    }
  }

  // CARBON_A → WETH → CounterB → CARBON_B
  for (const fee1 of fees) {
    for (const fee2 of fees) {
      for (const fee3 of fees) {
        routes.push({
          hops: [
            {
              tokenIn: carbonTokenA,
              tokenOut: weth,
              fee: fee1,
            },
            {
              tokenIn: weth,
              tokenOut: counterpartB,
              fee: fee2,
            },
            {
              tokenIn: counterpartB,
              tokenOut: carbonTokenB,
              fee: fee3,
            },
          ],
          description: `${carbonTokenA.symbol} → WETH → ${counterpartB.symbol} → ${carbonTokenB.symbol}`,
          tier: 3,
        })
      }
    }
  }

  return routes
}

/**
 * Generate all candidate routes for a swap
 * 
 * @param tokenIn - Input token
 * @param tokenOut - Output token
 * @param chainId - Chain ID
 * @param publicClient - Viem public client
 * @param fees - Fee tiers to try (default: [500, 3000, 10000])
 * @returns Array of candidate routes
 */
export async function generateCandidateRoutes(
  tokenIn: Currency,
  tokenOut: Currency,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  fees: FeeAmount[] = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH],
): Promise<CandidateRoute[]> {
  const tokenInWrapped = tokenIn.wrapped
  const tokenOutWrapped = tokenOut.wrapped

  // Check if tokens are Carbon tokens
  const [isTokenInCarbon, isTokenOutCarbon] = await Promise.all([
    getCarbonCounterpartToken(tokenInWrapped, chainId, publicClient).then((t) => t !== null),
    getCarbonCounterpartToken(tokenOutWrapped, chainId, publicClient).then((t) => t !== null),
  ])

  // Case 1: Normal tokens (neither is Carbon)
  if (!isTokenInCarbon && !isTokenOutCarbon) {
    // Add direct route
    const directRoutes = await generateNormalTokenRoutes(tokenIn, tokenOut, fees)
    
    // Add two-hop via WETH
    const weth = getWrappedNativeCurrency(chainId)
    const twoHopRoutes: CandidateRoute[] = []
    for (const fee1 of fees) {
      for (const fee2 of fees) {
        twoHopRoutes.push({
          hops: [
            {
              tokenIn: tokenInWrapped,
              tokenOut: weth,
              fee: fee1,
            },
            {
              tokenIn: weth,
              tokenOut: tokenOutWrapped,
              fee: fee2,
            },
          ],
          description: `${tokenIn.symbol} → WETH → ${tokenOut.symbol}`,
        })
      }
    }

    return [...directRoutes, ...twoHopRoutes]
  }

  // Case 2: Swapping TO a Carbon token
  if (!isTokenInCarbon && isTokenOutCarbon) {
    const counterpartToken = await getCarbonCounterpartToken(tokenOutWrapped, chainId, publicClient)
    if (!counterpartToken) {
      // Fallback to normal routing if counterpart lookup fails
      return generateNormalTokenRoutes(tokenIn, tokenOut, fees)
    }

    const weth = getWrappedNativeCurrency(chainId)
    return generateToCarbonRoutes(tokenIn, tokenOutWrapped, counterpartToken, weth, fees, chainId)
  }

  // Case 3: Swapping FROM a Carbon token
  if (isTokenInCarbon && !isTokenOutCarbon) {
    const counterpartToken = await getCarbonCounterpartToken(tokenInWrapped, chainId, publicClient)
    if (!counterpartToken) {
      // Fallback to normal routing if counterpart lookup fails
      return generateNormalTokenRoutes(tokenIn, tokenOut, fees)
    }

    const weth = getWrappedNativeCurrency(chainId)
    return generateFromCarbonRoutes(tokenInWrapped, counterpartToken, tokenOut, weth, fees, chainId)
  }

  // Case 4: Carbon-to-Carbon swap
  if (isTokenInCarbon && isTokenOutCarbon) {
    const [counterpartA, counterpartB] = await Promise.all([
      getCarbonCounterpartToken(tokenInWrapped, chainId, publicClient),
      getCarbonCounterpartToken(tokenOutWrapped, chainId, publicClient),
    ])

    if (!counterpartA || !counterpartB) {
      // Fallback to normal routing if counterpart lookup fails
      return generateNormalTokenRoutes(tokenIn, tokenOut, fees)
    }

    const weth = getWrappedNativeCurrency(chainId)
    return generateCarbonToCarbonRoutes(
      tokenInWrapped,
      counterpartA,
      tokenOutWrapped,
      counterpartB,
      weth,
      fees,
      chainId,
    )
  }

  // Should never reach here
  return []
}

