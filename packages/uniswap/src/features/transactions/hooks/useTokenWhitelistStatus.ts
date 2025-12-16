/**
 * Hook to check if a token is restricted and if the wallet is allowed to interact with it.
 *
 * Supports multiple restriction interfaces:
 * - isUserAllowed(address) - returns bool
 * - getRestriction(address) - returns uint8 (0 = allowed, non-zero = restricted)
 *
 * Falls back gracefully if token doesn't implement restriction interface.
 */

import { useQuery } from '@tanstack/react-query'
import { Currency } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'
import { Address, PublicClient } from 'viem'

/**
 * ABI for checking token restrictions
 * Supports multiple common restriction patterns used by RWA tokens
 */
const RESTRICTION_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'isUserAllowed',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getRestriction',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'isWhitelisted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'allowed',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'isAuthorized',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface TokenWhitelistStatus {
  isRestricted: boolean
  isAllowed: boolean
  isLoading: boolean
}

interface UseTokenWhitelistStatusParams {
  token: Currency | undefined
  walletAddress: Address | undefined
  chainId: EVMUniverseChainId | undefined
  enabled?: boolean
}

/**
 * Check if a token implements a restriction interface and if the wallet is allowed
 */
async function checkTokenWhitelistStatus(
  tokenAddress: Address,
  walletAddress: Address,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<{ isRestricted: boolean; isAllowed: boolean }> {
  try {
    // Try isUserAllowed first (most common pattern)
    try {
      const isAllowedRaw = await publicClient.readContract({
        address: tokenAddress,
        abi: RESTRICTION_ABI,
        functionName: 'isUserAllowed',
        args: [walletAddress],
      })

      // Convert to boolean explicitly
      const isAllowed = Boolean(isAllowedRaw)

      // If the call succeeds, the token is restricted
      // isUserAllowed returns true if user is allowed, false if not
      const result = {
        isRestricted: true,
        isAllowed,
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log('[useTokenWhitelistStatus] Token HAS restriction interface (isUserAllowed)', {
          tokenAddress,
          walletAddress,
          isAllowedRaw,
          isAllowed: result.isAllowed,
          isRestricted: result.isRestricted,
          willShowWarning: !result.isAllowed,
        })
        logger.debug(
          'useTokenWhitelistStatus',
          'checkTokenWhitelistStatus',
          'Token restriction check via isUserAllowed',
          {
            tokenAddress,
            walletAddress,
            chainId,
            isRestricted: result.isRestricted,
            isAllowed: result.isAllowed,
          },
        )
      }
      return result
    } catch (error) {
      // Function doesn't exist or call failed, try getRestriction
      try {
        const restriction = await publicClient.readContract({
          address: tokenAddress,
          abi: RESTRICTION_ABI,
          functionName: 'getRestriction',
          args: [walletAddress],
        })

        // If the call succeeds, the token is restricted
        // 0 = allowed, non-zero = restricted
        const result = {
          isRestricted: true,
          isAllowed: Number(restriction) === 0,
        }
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useTokenWhitelistStatus] Token HAS restriction interface (getRestriction)', {
            tokenAddress,
            walletAddress,
            restrictionValue: Number(restriction),
            isAllowed: result.isAllowed,
            isRestricted: result.isRestricted,
          })
          logger.debug(
            'useTokenWhitelistStatus',
            'checkTokenWhitelistStatus',
            'Token restriction check via getRestriction',
            {
              tokenAddress,
              walletAddress,
              chainId,
              restrictionValue: Number(restriction),
              isRestricted: result.isRestricted,
              isAllowed: result.isAllowed,
            },
          )
        }
        return result
      } catch (error2) {
        // Try additional common patterns
        const additionalPatterns = [
          { name: 'isWhitelisted', paramName: 'account' },
          { name: 'allowed', paramName: 'account' },
          { name: 'isAuthorized', paramName: 'account' },
        ]

        for (const pattern of additionalPatterns) {
          try {
            // Type assertion needed because TypeScript can't infer the union type
            const abiFunction = RESTRICTION_ABI.find((f) => f.name === pattern.name)
            if (!abiFunction) continue

            const result = await publicClient.readContract({
              address: tokenAddress,
              abi: [abiFunction] as typeof RESTRICTION_ABI,
              functionName: pattern.name as 'isWhitelisted' | 'allowed' | 'isAuthorized',
              args: [walletAddress],
            })

            const isAllowed = Boolean(result)
            const checkResult = {
              isRestricted: true,
              isAllowed,
            }

            if (process.env.NODE_ENV !== 'production') {
              console.log(`[useTokenWhitelistStatus] Token HAS restriction interface (${pattern.name})`, {
                tokenAddress,
                walletAddress,
                isAllowed,
                isRestricted: checkResult.isRestricted,
              })
            }
            return checkResult
          } catch (patternError) {
            // Continue to next pattern
            continue
          }
        }

        // None of the patterns matched, token is not restricted
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useTokenWhitelistStatus] Token does NOT have any known restriction interface', {
            tokenAddress,
            walletAddress,
            triedPatterns: ['isUserAllowed', 'getRestriction', ...additionalPatterns.map((p) => p.name)],
          })
        }
        return {
          isRestricted: false,
          isAllowed: true,
        }
      }
    }
  } catch (error) {
    // If all checks fail, assume token is not restricted (safe default)
    logger.debug('useTokenWhitelistStatus', 'checkTokenWhitelistStatus', 'Failed to check token restriction', {
      tokenAddress,
      walletAddress,
      chainId,
      error,
    })
    return {
      isRestricted: false,
      isAllowed: true,
    }
  }
}

/**
 * Hook to check token whitelist status for a single token
 */
export function useTokenWhitelistStatus({
  token,
  walletAddress,
  chainId,
  enabled = true,
}: UseTokenWhitelistStatusParams): TokenWhitelistStatus {
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  const tokenAddress = useMemo(() => {
    if (!token?.isToken || !token.address) {
      return undefined
    }
    return token.address as Address
  }, [token])

  const shouldEnable = enabled && !!tokenAddress && !!walletAddress && !!publicClient && !!chainId

  const { data, isLoading } = useQuery({
    queryKey: ['token-whitelist-status', chainId, tokenAddress, walletAddress],
    queryFn: async () => {
      if (!tokenAddress || !walletAddress || !publicClient || !chainId) {
        throw new Error('Missing required parameters for token whitelist check')
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[useTokenWhitelistStatus] Starting whitelist check', {
          tokenAddress,
          walletAddress,
          chainId,
        })
      }

      return checkTokenWhitelistStatus(tokenAddress, walletAddress, chainId, publicClient)
    },
    enabled: shouldEnable,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute
    retry: 1, // Only retry once to avoid spamming failed calls
    onError: (error) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[useTokenWhitelistStatus] Query error', {
          tokenAddress,
          walletAddress,
          chainId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })

  const result = {
    isRestricted: data?.isRestricted ?? false,
    isAllowed: data?.isAllowed ?? true,
    isLoading: isLoading && shouldEnable,
  }

  if (process.env.NODE_ENV !== 'production' && shouldEnable) {
    console.log('[useTokenWhitelistStatus] Query state', {
      tokenAddress,
      enabled: shouldEnable,
      isLoading,
      data,
      result,
    })
  }

  return result
}

/**
 * Hook to check whitelist status for multiple tokens (e.g., swap input/output or liquidity token0/token1)
 */
export function useTokensWhitelistStatus({
  tokens,
  walletAddress,
  chainId,
  enabled = true,
}: {
  tokens: (Currency | undefined)[]
  walletAddress: Address | undefined
  chainId: EVMUniverseChainId | undefined
  enabled?: boolean
}): {
  statuses: TokenWhitelistStatus[]
  hasRestrictedTokenNotAllowed: boolean
  isLoading: boolean
} {
  const statuses = tokens.map((token) =>
    useTokenWhitelistStatus({
      token,
      walletAddress,
      chainId,
      enabled,
    }),
  )

  const hasRestrictedTokenNotAllowed = useMemo(() => {
    return statuses.some((status) => status.isRestricted && !status.isAllowed)
  }, [statuses])

  const isLoading = useMemo(() => {
    return statuses.some((status) => status.isLoading)
  }, [statuses])

  return {
    statuses,
    hasRestrictedTokenNotAllowed,
    isLoading,
  }
}
