/**
 * Hook to check whitelist status for pool address and position manager
 *
 * For restricted tokens, we need to verify:
 * 1. The computed pool address is whitelisted (even if not deployed yet)
 * 2. The position manager/router is whitelisted
 * 3. The user wallet is whitelisted (handled separately)
 */

import { useQuery } from '@tanstack/react-query'
import { PERMIT2_ADDRESS } from '@uniswap/permit2-sdk'
import { Currency, Token } from '@uniswap/sdk-core'
import { computePoolAddress, FeeAmount } from '@uniswap/v3-sdk'
import { useMemo } from 'react'
import {
  AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  AGROSWAP_V3_CORE_FACTORY_ADDRESSES,
  getAgroswapSwapRouterAddress,
} from 'uniswap/src/constants/agroswapAddresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { useTokenWhitelistStatus } from 'uniswap/src/features/transactions/hooks/useTokenWhitelistStatus'
import { Address, PublicClient } from 'viem'

// ABI for checking token restrictions (same as in useTokenWhitelistStatus)
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

export interface PoolWhitelistStatus {
  poolAddress: Address | undefined
  poolExists: boolean
  poolIsWhitelisted: boolean | undefined // undefined if token not restricted or check pending
  positionManagerIsWhitelisted: boolean | undefined
  swapRouterIsWhitelisted: boolean | undefined // for swap flows
  permit2IsWhitelisted: boolean | undefined // Permit2 address whitelist status
  isLoading: boolean
  hasRestriction: boolean // true if any token is restricted
  warnings: string[] // Array of warning messages
}

interface UsePoolWhitelistStatusParams {
  token0: Currency | undefined
  token1: Currency | undefined
  fee: FeeAmount | undefined
  chainId: EVMUniverseChainId | undefined
  walletAddress: Address | undefined
  enabled?: boolean
  checkSwapRouter?: boolean // If true, also check swap router whitelist status
}

/**
 * Check if an address is whitelisted for a restricted token
 * Returns: true if whitelisted, false if not whitelisted, undefined if token doesn't have restriction interface
 */
async function checkAddressWhitelistStatus(
  tokenAddress: Address,
  addressToCheck: Address,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<boolean | undefined> {
  try {
    // Try isUserAllowed first (from ERC20Restricted extension)
    // Use the full RESTRICTION_ABI to ensure proper function detection
    try {
      const isAllowed = await publicClient.readContract({
        address: tokenAddress,
        abi: RESTRICTION_ABI,
        functionName: 'isUserAllowed',
        args: [addressToCheck],
      })
      const result = Boolean(isAllowed)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[usePoolWhitelistStatus] isUserAllowed result', {
          tokenAddress,
          addressToCheck,
          isAllowed: result,
        })
      }
      return result
    } catch (error) {
      // Check if it's a function not found error or a revert
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[usePoolWhitelistStatus] isUserAllowed failed, trying alternatives', {
          tokenAddress,
          addressToCheck,
          error: errorMessage,
        })
      }

      // If the error indicates the function doesn't exist, try getRestriction
      // Common errors: "Function not found", "execution reverted", etc.
      if (
        errorMessage.includes('Function') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('execution reverted')
      ) {
        try {
          const restriction = await publicClient.readContract({
            address: tokenAddress,
            abi: RESTRICTION_ABI,
            functionName: 'getRestriction',
            args: [addressToCheck],
          })
          const result = Number(restriction) === 0
          if (process.env.NODE_ENV !== 'production') {
            console.log('[usePoolWhitelistStatus] getRestriction result', {
              tokenAddress,
              addressToCheck,
              restriction: Number(restriction),
              isAllowed: result,
            })
          }
          return result
        } catch (getRestrictionError) {
          // Try additional patterns
          const additionalPatterns = [
            { name: 'isWhitelisted', paramName: 'account' },
            { name: 'allowed', paramName: 'account' },
            { name: 'isAuthorized', paramName: 'account' },
          ]

          for (const pattern of additionalPatterns) {
            try {
              const abiFunction = RESTRICTION_ABI.find((f) => f.name === pattern.name)
              if (!abiFunction) continue

              const result = await publicClient.readContract({
                address: tokenAddress,
                abi: [abiFunction] as typeof RESTRICTION_ABI,
                functionName: pattern.name as 'isWhitelisted' | 'allowed' | 'isAuthorized',
                args: [addressToCheck],
              })
              const boolResult = Boolean(result)
              if (process.env.NODE_ENV !== 'production') {
                console.log(`[usePoolWhitelistStatus] ${pattern.name} result`, {
                  tokenAddress,
                  addressToCheck,
                  isAllowed: boolResult,
                })
              }
              return boolResult
            } catch {
              continue
            }
          }

          // Token doesn't have any restriction interface - return undefined to indicate we can't check
          if (process.env.NODE_ENV !== 'production') {
            console.log('[usePoolWhitelistStatus] Token does not have restriction interface, cannot check whitelist', {
              tokenAddress,
              addressToCheck,
              isUserAllowedError: errorMessage,
              getRestrictionError:
                getRestrictionError instanceof Error ? getRestrictionError.message : String(getRestrictionError),
            })
          }
          return undefined
        }
      } else {
        // Unexpected error - log it but still return undefined
        if (process.env.NODE_ENV !== 'production') {
          console.error('[usePoolWhitelistStatus] Unexpected error calling isUserAllowed', {
            tokenAddress,
            addressToCheck,
            error: errorMessage,
          })
        }
        return undefined
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[usePoolWhitelistStatus] Error checking address whitelist', {
        tokenAddress,
        addressToCheck,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined // Return undefined on error to indicate we can't determine status
  }
}

/**
 * Check if a contract address exists (has code)
 */
async function checkContractExists(address: Address, publicClient: PublicClient): Promise<boolean> {
  try {
    const code = await publicClient.getBytecode({ address })
    return code !== undefined && code !== '0x' && code.length > 2
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[usePoolWhitelistStatus] Error checking contract existence', {
        address,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return false
  }
}

/**
 * Hook to check pool and position manager whitelist status
 */
export function usePoolWhitelistStatus({
  token0,
  token1,
  fee,
  chainId,
  walletAddress,
  enabled = true,
  checkSwapRouter = false,
}: UsePoolWhitelistStatusParams): PoolWhitelistStatus {
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Check if tokens are restricted
  const token0Status = useTokenWhitelistStatus({
    token: token0,
    walletAddress,
    chainId,
    enabled: enabled && !!token0?.isToken && !!walletAddress && !!chainId,
  })

  const token1Status = useTokenWhitelistStatus({
    token: token1,
    walletAddress,
    chainId,
    enabled: enabled && !!token1?.isToken && !!walletAddress && !!chainId,
  })

  const hasRestriction = token0Status.isRestricted || token1Status.isRestricted

  // Identify the RWA token(s) that inherit from ERC20Restricted
  // We should call isUserAllowed on the RWA token to check if addresses are whitelisted
  const restrictedTokenAddress = useMemo(() => {
    // Prefer token0 if it's restricted
    if (token0Status.isRestricted && token0?.isToken) {
      return token0.address as Address
    }
    // Otherwise use token1 if it's restricted
    if (token1Status.isRestricted && token1?.isToken) {
      return token1.address as Address
    }
    // If neither is restricted, we can't check whitelist status
    return undefined
  }, [token0Status, token1Status, token0, token1])

  // Also keep track of both restricted tokens (in case both are restricted)
  const allRestrictedTokens = useMemo(() => {
    const tokens: Address[] = []
    if (token0Status.isRestricted && token0?.isToken) {
      tokens.push(token0.address as Address)
    }
    if (token1Status.isRestricted && token1?.isToken) {
      tokens.push(token1.address as Address)
    }
    return tokens
  }, [token0Status, token1Status, token0, token1])

  // Compute pool address deterministically
  const poolAddress = useMemo(() => {
    if (!token0?.isToken || !token1?.isToken || !fee || !chainId) {
      return undefined
    }

    try {
      const factoryAddresses = AGROSWAP_V3_CORE_FACTORY_ADDRESSES
      const factoryAddress = factoryAddresses[chainId as keyof typeof factoryAddresses] as string | undefined

      if (!factoryAddress) {
        return undefined
      }

      // Sort tokens (required for pool address computation)
      // Use wrapped tokens for sorting and computation
      const token0Wrapped = token0.wrapped as Token
      const token1Wrapped = token1.wrapped as Token
      const [tokenA, tokenB] = token0Wrapped.sortsBefore(token1Wrapped)
        ? [token0Wrapped, token1Wrapped]
        : [token1Wrapped, token0Wrapped]

      const computedAddress = computePoolAddress({
        factoryAddress,
        tokenA,
        tokenB,
        fee,
        chainId: chainId as number,
      })

      return computedAddress as Address
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[usePoolWhitelistStatus] Error computing pool address', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return undefined
    }
  }, [token0, token1, fee, chainId])

  // Get position manager address
  const positionManagerAddress = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    const addresses = AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
    return addresses[chainId as keyof typeof addresses] as Address | undefined
  }, [chainId])

  // Get swap router address (if needed)
  const swapRouterAddress = useMemo(() => {
    if (!chainId || !checkSwapRouter) {
      return undefined
    }
    try {
      return getAgroswapSwapRouterAddress(chainId) as Address | undefined
    } catch {
      return undefined
    }
  }, [chainId, checkSwapRouter])

  // Get Permit2 address (same on all chains)
  const permit2Address = useMemo(() => {
    return PERMIT2_ADDRESS as Address
  }, [])

  // Check if pool exists first (we need this to determine if we should check whitelist)
  const { data: poolExists, isLoading: poolExistsLoading } = useQuery({
    queryKey: ['pool-exists', chainId, poolAddress],
    queryFn: async () => {
      if (!poolAddress || !publicClient) {
        return false
      }
      return checkContractExists(poolAddress, publicClient)
    },
    enabled: enabled && !!poolAddress && !!publicClient,
    staleTime: 60_000, // 1 minute
    gcTime: 120_000, // 2 minutes
  })

  // Check if pool address is whitelisted on the RWA token
  // Only check if pool exists (can't be whitelisted if it doesn't exist)
  const { data: poolIsWhitelisted, isLoading: poolWhitelistLoading } = useQuery({
    queryKey: ['pool-whitelist-status', chainId, poolAddress, restrictedTokenAddress, poolExists],
    queryFn: async () => {
      if (!poolAddress || !restrictedTokenAddress || !publicClient || !chainId) {
        return undefined
      }
      // If pool doesn't exist, it can't be whitelisted
      if (poolExists === false) {
        return false
      }
      // Call isUserAllowed on the RWA token to check if pool is whitelisted
      const result = await checkAddressWhitelistStatus(restrictedTokenAddress, poolAddress, chainId, publicClient)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[usePoolWhitelistStatus] Pool whitelist check result (on RWA token)', {
          poolAddress,
          rwaTokenAddress: restrictedTokenAddress,
          poolExists,
          result,
          isWhitelisted: result === true,
          isNotWhitelisted: result === false,
          cannotCheck: result === undefined,
        })
      }
      return result
    },
    enabled: enabled && !!poolAddress && !!restrictedTokenAddress && !!publicClient && poolExists === true,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute
  })

  // Check if position manager is whitelisted on the RWA token
  // Call isUserAllowed on the RWA token (ERC20Restricted) to check if position manager is allowed
  const { data: positionManagerIsWhitelisted, isLoading: positionManagerWhitelistLoading } = useQuery({
    queryKey: ['position-manager-whitelist-status', chainId, positionManagerAddress, restrictedTokenAddress],
    queryFn: async () => {
      if (!positionManagerAddress || !restrictedTokenAddress || !publicClient || !chainId) {
        return undefined
      }

      // Call isUserAllowed on the RWA token to check if position manager is whitelisted
      const result = await checkAddressWhitelistStatus(
        restrictedTokenAddress,
        positionManagerAddress,
        chainId,
        publicClient,
      )
      if (process.env.NODE_ENV !== 'production') {
        console.log('[usePoolWhitelistStatus] Position Manager whitelist check (on RWA token)', {
          rwaTokenAddress: restrictedTokenAddress,
          positionManagerAddress,
          result,
        })
      }
      return result
    },
    enabled: enabled && !!positionManagerAddress && !!restrictedTokenAddress && !!publicClient,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute
  })

  // Check if swap router is whitelisted on the RWA token (only if checkSwapRouter is true)
  // Call isUserAllowed on the RWA token (ERC20Restricted) to check if swap router is allowed
  const { data: swapRouterIsWhitelisted, isLoading: swapRouterWhitelistLoading } = useQuery({
    queryKey: ['swap-router-whitelist-status', chainId, swapRouterAddress, restrictedTokenAddress],
    queryFn: async () => {
      if (!swapRouterAddress || !restrictedTokenAddress || !publicClient || !chainId) {
        return undefined
      }
      // Call isUserAllowed on the RWA token to check if swap router is whitelisted
      const result = await checkAddressWhitelistStatus(restrictedTokenAddress, swapRouterAddress, chainId, publicClient)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[usePoolWhitelistStatus] Swap Router whitelist check (on RWA token)', {
          rwaTokenAddress: restrictedTokenAddress,
          swapRouterAddress,
          result,
        })
      }
      return result
    },
    enabled: enabled && !!swapRouterAddress && !!restrictedTokenAddress && !!publicClient && checkSwapRouter === true,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute
  })

  // Check if Permit2 is whitelisted on the RWA token
  // Call isUserAllowed on the RWA token (ERC20Restricted) to check if Permit2 is allowed
  const { data: permit2IsWhitelisted, isLoading: permit2WhitelistLoading } = useQuery({
    queryKey: ['permit2-whitelist-status', chainId, permit2Address, restrictedTokenAddress],
    queryFn: async () => {
      if (!permit2Address || !restrictedTokenAddress || !publicClient || !chainId) {
        return undefined
      }

      // Call isUserAllowed on the RWA token to check if Permit2 is whitelisted
      const result = await checkAddressWhitelistStatus(restrictedTokenAddress, permit2Address, chainId, publicClient)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[usePoolWhitelistStatus] Permit2 whitelist check (on RWA token)', {
          rwaTokenAddress: restrictedTokenAddress,
          permit2Address,
          result,
        })
      }
      return result
    },
    enabled: enabled && !!permit2Address && !!restrictedTokenAddress && !!publicClient,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute
  })

  // Build warnings
  const warnings = useMemo(() => {
    const warningList: string[] = []

    // Check pool whitelist regardless of token restriction status
    // The pool address needs to be whitelisted for transfers to work
    if (poolAddress) {
      // If pool doesn't exist, it can't be whitelisted
      if (poolExists === false) {
        warningList.push(`Pool address ${poolAddress} does not exist and cannot be whitelisted`)
      } else if (poolIsWhitelisted === false) {
        warningList.push(`Pool address ${poolAddress} is not whitelisted`)
      } else if (poolIsWhitelisted === undefined && poolExists === true) {
        warningList.push(`Cannot determine if pool address ${poolAddress} is whitelisted - transaction may fail`)
      }

      if (positionManagerIsWhitelisted === false && positionManagerAddress) {
        warningList.push(`Position manager ${positionManagerAddress} is not whitelisted`)
      } else if (positionManagerIsWhitelisted === undefined && positionManagerAddress) {
        warningList.push(
          `Cannot determine if position manager ${positionManagerAddress} is whitelisted - transaction may fail`,
        )
      }

      if (swapRouterIsWhitelisted === false && swapRouterAddress) {
        warningList.push(`Swap router ${swapRouterAddress} is not whitelisted`)
      } else if (swapRouterIsWhitelisted === undefined && swapRouterAddress) {
        warningList.push(`Cannot determine if swap router ${swapRouterAddress} is whitelisted - transaction may fail`)
      }

      if (permit2IsWhitelisted === false) {
        warningList.push(`Permit2 ${permit2Address} is not whitelisted`)
      } else if (permit2IsWhitelisted === undefined) {
        warningList.push(`Cannot determine if Permit2 ${permit2Address} is whitelisted - transaction may fail`)
      }
    }

    return warningList
  }, [
    poolAddress,
    poolExists,
    poolIsWhitelisted,
    positionManagerIsWhitelisted,
    positionManagerAddress,
    swapRouterIsWhitelisted,
    swapRouterAddress,
    permit2IsWhitelisted,
    permit2Address,
  ])

  const isLoading =
    poolExistsLoading ||
    poolWhitelistLoading ||
    positionManagerWhitelistLoading ||
    swapRouterWhitelistLoading ||
    permit2WhitelistLoading ||
    token0Status.isLoading ||
    token1Status.isLoading

  if (process.env.NODE_ENV !== 'production') {
    console.log('[usePoolWhitelistStatus] Status', {
      poolAddress,
      poolExists: poolExists ?? false,
      poolIsWhitelisted,
      positionManagerAddress,
      positionManagerIsWhitelisted,
      swapRouterAddress,
      swapRouterIsWhitelisted,
      permit2Address,
      permit2IsWhitelisted,
      hasRestriction,
      warnings,
      isLoading,
    })
  }

  // If pool doesn't exist, set poolIsWhitelisted to false (can't be whitelisted if it doesn't exist)
  const finalPoolIsWhitelisted = useMemo(() => {
    if (poolExists === false) {
      return false
    }
    return poolIsWhitelisted
  }, [poolExists, poolIsWhitelisted])

  return {
    poolAddress,
    poolExists: poolExists ?? false,
    poolIsWhitelisted: finalPoolIsWhitelisted,
    positionManagerIsWhitelisted,
    swapRouterIsWhitelisted,
    permit2IsWhitelisted,
    isLoading,
    hasRestriction,
    warnings,
  }
}
