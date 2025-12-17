/**
 * Core hook for checking restricted token allowlist status
 *
 * This hook consolidates all allowlist checks for RWA tokens (ERC20Restricted) across
 * swap and liquidity flows. It checks:
 * - Wallet address (always checked for each restricted token)
 * - Permit2 address
 * - Swap Router address (for swaps)
 * - Position Manager address (for liquidity)
 * - Pool address(es) (computed deterministically)
 *
 * Returns blocking and non-blocking warnings, plus debug information.
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
import { getQuoterV2Address } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { useTokenWhitelistStatus } from 'uniswap/src/features/transactions/hooks/useTokenWhitelistStatus'
import { Address, PublicClient } from 'viem'

// ABI for checking token restrictions (ERC20Restricted from OpenZeppelin)
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
] as const

export interface AllowlistCheckResult {
  tokenAddress: Address
  tokenSymbol?: string
  subjectAddress: Address
  subjectLabel: string
  isAllowed: boolean | undefined // true = allowed, false = not allowed, undefined = cannot determine
  error?: string
}

export interface RestrictedTokenAllowlistChecks {
  blockingWarnings: Array<{
    tokenAddress: Address
    tokenSymbol?: string
    subjectAddress: Address
    subjectLabel: string
    message: string
  }>
  nonBlockingWarnings: Array<{
    tokenAddress: Address
    tokenSymbol?: string
    subjectAddress: Address
    subjectLabel: string
    message: string
  }>
  isBlocked: boolean
  isLoading: boolean
  quoterAllowed?: boolean // true if quoter is allowlisted for all restricted tokens, false if not, undefined if not checked
  notAllowedSubjects: Array<{
    type: 'wallet' | 'permit2' | 'swapRouter' | 'positionManager' | 'pool' | 'quoter'
    address: Address
    token: Address
    tokenSymbol?: string
  }>
  debug: {
    checked: AllowlistCheckResult[]
    restrictedTokens: Array<{ address: Address; symbol?: string }>
  }
}

interface UseRestrictedTokenAllowlistChecksParams {
  account: Address | undefined
  chainId: EVMUniverseChainId | undefined
  tokens: {
    tokenA: Currency | undefined
    tokenB: Currency | undefined
  }
  feeAmount?: FeeAmount // Required for liquidity flow, optional for swap (if single pool)
  flow: 'swap' | 'liquidity'
  poolAddresses?: Address[] // For multi-hop swaps, provide all pool addresses
  enabled?: boolean
}

/**
 * Shared helper to check if an address is allowed on a restricted token
 * Calls isUserAllowed(address) on the token contract (ERC20Restricted)
 */
async function checkIsUserAllowed(
  tokenAddress: Address,
  subjectAddress: Address,
  publicClient: PublicClient,
): Promise<{ isAllowed: boolean | undefined; error?: string }> {
  try {
    // Try isUserAllowed first (from ERC20Restricted extension)
    try {
      const isAllowed = await publicClient.readContract({
        address: tokenAddress,
        abi: RESTRICTION_ABI,
        functionName: 'isUserAllowed',
        args: [subjectAddress],
      })
      return { isAllowed: Boolean(isAllowed) }
    } catch (error) {
      // Try getRestriction as fallback
      try {
        const restriction = await publicClient.readContract({
          address: tokenAddress,
          abi: RESTRICTION_ABI,
          functionName: 'getRestriction',
          args: [subjectAddress],
        })
        // getRestriction returns 0 for allowed, non-zero for restricted
        return { isAllowed: Number(restriction) === 0 }
      } catch (fallbackError) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useRestrictedTokenAllowlistChecks] Cannot check allowlist status', {
            tokenAddress,
            subjectAddress,
            isUserAllowedError: errorMessage,
            getRestrictionError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          })
        }
        return { isAllowed: undefined, error: errorMessage }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (process.env.NODE_ENV !== 'production') {
      console.error('[useRestrictedTokenAllowlistChecks] Error checking allowlist', {
        tokenAddress,
        subjectAddress,
        error: errorMessage,
      })
    }
    return { isAllowed: undefined, error: errorMessage }
  }
}

/**
 * Compute pool address deterministically using CREATE2 semantics
 */
function computePoolAddressDeterministic(
  token0: Token,
  token1: Token,
  fee: FeeAmount,
  chainId: EVMUniverseChainId,
): Address | undefined {
  try {
    const factoryAddresses = AGROSWAP_V3_CORE_FACTORY_ADDRESSES
    const factoryAddress = factoryAddresses[chainId as keyof typeof factoryAddresses] as string | undefined

    if (!factoryAddress) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[useRestrictedTokenAllowlistChecks] Factory address not found', { chainId })
      }
      return undefined
    }

    // Sort tokens (required for pool address computation)
    const token0Wrapped = token0.wrapped
    const token1Wrapped = token1.wrapped
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
      console.error('[useRestrictedTokenAllowlistChecks] Error computing pool address', {
        error: error instanceof Error ? error.message : String(error),
        token0: token0.address,
        token1: token1.address,
        fee,
        chainId,
      })
    }
    return undefined
  }
}

/**
 * Check if a contract exists on-chain
 */
async function checkContractExists(address: Address, publicClient: PublicClient): Promise<boolean> {
  try {
    const code = await publicClient.getBytecode({ address })
    return code !== undefined && code !== '0x' && code.length > 2
  } catch {
    return false
  }
}

/**
 * Core hook for checking restricted token allowlist status
 */
export function useRestrictedTokenAllowlistChecks({
  account,
  chainId,
  tokens: { tokenA, tokenB },
  feeAmount,
  flow,
  poolAddresses,
  enabled = true,
}: UseRestrictedTokenAllowlistChecksParams): RestrictedTokenAllowlistChecks {
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Check if tokens are restricted
  const tokenAStatus = useTokenWhitelistStatus({
    token: tokenA,
    walletAddress: account,
    chainId,
    enabled: enabled && !!tokenA?.isToken && !!account && !!chainId,
  })

  const tokenBStatus = useTokenWhitelistStatus({
    token: tokenB,
    walletAddress: account,
    chainId,
    enabled: enabled && !!tokenB?.isToken && !!account && !!chainId,
  })

  // Identify restricted tokens and compute stable primitives for query keys
  const { restrictedTokens, restrictedTokenAddresses, restrictedTokenKey, restrictedTokenMap } = useMemo(() => {
    const tokens: Array<{ address: Address; symbol?: string }> = []
    const addresses: string[] = []
    const tokenMap = new Map<string, { address: Address; symbol?: string }>()

    // Only add if we know for sure it's restricted (not loading)
    if (tokenAStatus.isRestricted && !tokenAStatus.isLoading && tokenA?.isToken) {
      const addr = (tokenA.address as Address).toLowerCase()
      if (!addresses.includes(addr)) {
        addresses.push(addr)
        const tokenInfo = { address: tokenA.address as Address, symbol: tokenA.symbol }
        tokens.push(tokenInfo)
        tokenMap.set(addr, tokenInfo)
      }
    }
    if (tokenBStatus.isRestricted && !tokenBStatus.isLoading && tokenB?.isToken) {
      const addr = (tokenB.address as Address).toLowerCase()
      if (!addresses.includes(addr)) {
        addresses.push(addr)
        const tokenInfo = { address: tokenB.address as Address, symbol: tokenB.symbol }
        tokens.push(tokenInfo)
        tokenMap.set(addr, tokenInfo)
      }
    }

    // Sort and dedupe addresses for stable key
    const sortedAddresses = [...new Set(addresses)].sort()
    const key = sortedAddresses.join(',')

    return {
      restrictedTokens: tokens,
      restrictedTokenAddresses: sortedAddresses,
      restrictedTokenKey: key,
      restrictedTokenMap: tokenMap,
    }
  }, [
    tokenAStatus.isRestricted,
    tokenAStatus.isLoading,
    tokenA,
    tokenBStatus.isRestricted,
    tokenBStatus.isLoading,
    tokenB,
  ])

  // Compute stable primitives for query keys
  const accountKey = useMemo(() => account?.toLowerCase() ?? '', [account])
  const chainKey = useMemo(() => String(chainId ?? ''), [chainId])

  // Enablement conditions - minimal and explicit
  const hasRestricted = restrictedTokenAddresses.length > 0
  const hasAccount = Boolean(account)
  const hasChain = Boolean(chainId)

  if (process.env.NODE_ENV !== 'production') {
    console.log('[useRestrictedTokenAllowlistChecks] Restricted tokens detection', {
      tokenA: tokenA?.isToken ? tokenA.address : 'not a token',
      tokenAStatus: {
        isRestricted: tokenAStatus.isRestricted,
        isLoading: tokenAStatus.isLoading,
      },
      tokenB: tokenB?.isToken ? tokenB.address : 'not a token',
      tokenBStatus: {
        isRestricted: tokenBStatus.isRestricted,
        isLoading: tokenBStatus.isLoading,
      },
      restrictedTokens: restrictedTokens.length,
      restrictedTokenAddresses,
      restrictedTokenKey,
      hasRestricted,
      hasAccount,
      hasChain,
    })
  }

  // Get addresses to check based on flow type - compute as stable primitives
  const { addressesToCheck, subjectAddresses, subjectAddressKey } = useMemo(() => {
    if (!chainId) {
      return { addressesToCheck: [], subjectAddresses: [], subjectAddressKey: '' }
    }

    const addresses: Array<{ address: Address; label: string }> = []
    const subjectMap = new Map<string, { address: Address; label: string }>()

    // Always check Permit2 (used in approval/transfer paths)
    const permit2Addr = (PERMIT2_ADDRESS as Address).toLowerCase()
    addresses.push({ address: PERMIT2_ADDRESS as Address, label: 'Permit2' })
    subjectMap.set(permit2Addr, { address: PERMIT2_ADDRESS as Address, label: 'Permit2' })

    if (flow === 'swap') {
      // For swaps: check swap router
      try {
        const routerAddress = getAgroswapSwapRouterAddress(chainId) as Address
        const routerAddr = routerAddress.toLowerCase()
        addresses.push({ address: routerAddress, label: 'Swap Router' })
        subjectMap.set(routerAddr, { address: routerAddress, label: 'Swap Router' })
      } catch {
        // Router address not available
      }

      // For swaps: check QuoterV2 (needed for quote simulation)
      try {
        const quoterAddress = getQuoterV2Address(chainId)
        if (quoterAddress) {
          const quoterAddr = quoterAddress.toLowerCase()
          addresses.push({ address: quoterAddress as Address, label: 'Quoter' })
          subjectMap.set(quoterAddr, { address: quoterAddress as Address, label: 'Quoter' })
        }
      } catch {
        // Quoter address not available
      }
    } else if (flow === 'liquidity') {
      // For liquidity: check position manager
      const positionManagerAddresses = AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
      const positionManagerAddress = positionManagerAddresses[chainId as keyof typeof positionManagerAddresses] as
        | Address
        | undefined
      if (positionManagerAddress) {
        const pmAddr = positionManagerAddress.toLowerCase()
        addresses.push({ address: positionManagerAddress, label: 'Position Manager' })
        subjectMap.set(pmAddr, { address: positionManagerAddress, label: 'Position Manager' })
      }

      // For liquidity: also check QuoterV2 (needed for quote simulation when calculating position value)
      try {
        const quoterAddress = getQuoterV2Address(chainId)
        if (quoterAddress) {
          const quoterAddr = quoterAddress.toLowerCase()
          addresses.push({ address: quoterAddress as Address, label: 'Quoter' })
          subjectMap.set(quoterAddr, { address: quoterAddress as Address, label: 'Quoter' })
        }
      } catch {
        // Quoter address not available
      }
    }

    // Normalize, dedupe, and sort for stable key
    const sortedSubjects = Array.from(subjectMap.values())
      .map((s) => ({ ...s, addressLower: s.address.toLowerCase() }))
      .sort((a, b) => a.addressLower.localeCompare(b.addressLower))
      .map((s) => ({ address: s.address, label: s.label }))

    const subjectKey = sortedSubjects.map((s) => s.address.toLowerCase()).join(',')

    return {
      addressesToCheck: addresses,
      subjectAddresses: sortedSubjects,
      subjectAddressKey: subjectKey,
    }
  }, [chainId, flow])

  // Compute pool address(es) and add to subjects
  const { computedPoolAddresses, allSubjectAddresses, allSubjectAddressKey } = useMemo(() => {
    let pools: Address[] = []
    if (poolAddresses) {
      // Use provided pool addresses (for multi-hop swaps)
      pools = poolAddresses
    } else if (tokenA?.isToken && tokenB?.isToken && feeAmount && chainId) {
      // Compute pool address for liquidity flow or single-pool swap
      const poolAddress = computePoolAddressDeterministic(tokenA as Token, tokenB as Token, feeAmount, chainId)
      if (poolAddress) {
        pools = [poolAddress]
      }
    }

    // Combine addressesToCheck with pool addresses
    const allSubjects = new Map<string, { address: Address; label: string }>()

    // Add non-pool subjects
    for (const { address, label } of subjectAddresses) {
      const addrLower = address.toLowerCase()
      allSubjects.set(addrLower, { address, label })
    }

    // Add pool addresses
    pools.forEach((poolAddress, index) => {
      const addrLower = poolAddress.toLowerCase()
      allSubjects.set(addrLower, {
        address: poolAddress,
        label: pools.length > 1 ? `Pool ${index + 1}` : 'Pool',
      })
    })

    // Sort for stable key
    const sorted = Array.from(allSubjects.values())
      .map((s) => ({ ...s, addressLower: s.address.toLowerCase() }))
      .sort((a, b) => a.addressLower.localeCompare(b.addressLower))
      .map((s) => ({ address: s.address, label: s.label }))

    const key = sorted.map((s) => s.address.toLowerCase()).join(',')

    return {
      computedPoolAddresses: pools,
      allSubjectAddresses: sorted,
      allSubjectAddressKey: key,
    }
  }, [poolAddresses, tokenA, tokenB, feeAmount, chainId, subjectAddresses])

  // Check wallet address for each restricted token
  // Enabled conditions - minimal and explicit
  const walletChecksEnabled = enabled && hasRestricted && hasAccount && hasChain && !!publicClient
  const walletChecks = useQuery({
    queryKey: ['restricted-allowlist', 'wallet', chainKey, accountKey, restrictedTokenKey],
    queryFn: async () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[useRestrictedTokenAllowlistChecks] Wallet queryFn executing', {
          restrictedTokenAddresses: restrictedTokenAddresses.length,
          accountKey,
          chainKey,
        })
      }

      if (!account || !publicClient || restrictedTokenAddresses.length === 0) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useRestrictedTokenAllowlistChecks] Wallet queryFn early return', {
            hasAccount: !!account,
            hasPublicClient: !!publicClient,
            hasRestrictedTokens: restrictedTokenAddresses.length > 0,
          })
        }
        return []
      }

      const results: AllowlistCheckResult[] = []
      for (const tokenAddr of restrictedTokenAddresses) {
        const tokenInfo = restrictedTokenMap.get(tokenAddr)
        if (!tokenInfo) continue

        const { isAllowed, error } = await checkIsUserAllowed(tokenInfo.address, account, publicClient)
        results.push({
          tokenAddress: tokenInfo.address,
          tokenSymbol: tokenInfo.symbol,
          subjectAddress: account,
          subjectLabel: 'Wallet',
          isAllowed,
          error,
        })
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[useRestrictedTokenAllowlistChecks] Wallet checks completed', {
          restrictedTokenAddresses: restrictedTokenAddresses.length,
          results: results.length,
          results,
        })
      }
      return results
    },
    enabled: walletChecksEnabled,
    staleTime: 30_000,
    gcTime: 60_000,
  })

  if (process.env.NODE_ENV !== 'production') {
    const enabledReason = walletChecksEnabled
      ? 'enabled'
      : !enabled
        ? 'hook disabled'
        : !hasRestricted
          ? 'no restricted tokens'
          : !hasAccount
            ? 'no account'
            : !hasChain
              ? 'no chainId'
              : !publicClient
                ? 'no publicClient'
                : 'unknown'
    console.log('[useRestrictedTokenAllowlistChecks] Wallet checks query state', {
      enabled: walletChecksEnabled,
      enabledReason,
      hasRestricted,
      hasAccount,
      hasChain,
      publicClient: !!publicClient,
      restrictedTokenAddresses: restrictedTokenAddresses.length,
      restrictedTokenKey,
      accountKey,
      chainKey,
      isLoading: walletChecks.isLoading,
      isFetching: walletChecks.isFetching,
      dataLength: walletChecks.data?.length ?? 0,
      hasData: !!walletChecks.data,
    })
  }

  // Check all other addresses for each restricted token
  // Enabled conditions - minimal and explicit
  const hasSubjects = allSubjectAddresses.length > 0
  const addressChecksEnabled = enabled && hasRestricted && hasChain && hasSubjects && !!publicClient
  const addressChecks = useQuery({
    queryKey: ['restricted-allowlist', 'subjects', chainKey, restrictedTokenKey, allSubjectAddressKey],
    queryFn: async () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[useRestrictedTokenAllowlistChecks] Address queryFn executing', {
          restrictedTokenAddresses: restrictedTokenAddresses.length,
          subjectAddresses: allSubjectAddresses.length,
          chainKey,
        })
      }

      if (!publicClient || restrictedTokenAddresses.length === 0 || allSubjectAddresses.length === 0) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[useRestrictedTokenAllowlistChecks] Address queryFn early return', {
            hasPublicClient: !!publicClient,
            hasRestrictedTokens: restrictedTokenAddresses.length > 0,
            hasSubjects: allSubjectAddresses.length > 0,
          })
        }
        return []
      }

      const results: AllowlistCheckResult[] = []
      for (const tokenAddr of restrictedTokenAddresses) {
        const tokenInfo = restrictedTokenMap.get(tokenAddr)
        if (!tokenInfo) continue

        for (const { address, label } of allSubjectAddresses) {
          const { isAllowed, error } = await checkIsUserAllowed(tokenInfo.address, address, publicClient)
          results.push({
            tokenAddress: tokenInfo.address,
            tokenSymbol: tokenInfo.symbol,
            subjectAddress: address,
            subjectLabel: label,
            isAllowed,
            error,
          })
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[useRestrictedTokenAllowlistChecks] Address checks completed', {
          restrictedTokenAddresses: restrictedTokenAddresses.length,
          subjectAddresses: allSubjectAddresses.length,
          expectedChecks: restrictedTokenAddresses.length * allSubjectAddresses.length,
          results: results.length,
          results,
        })
      }
      return results
    },
    enabled: addressChecksEnabled,
    staleTime: 30_000,
    gcTime: 60_000,
  })

  if (process.env.NODE_ENV !== 'production') {
    const enabledReason = addressChecksEnabled
      ? 'enabled'
      : !enabled
        ? 'hook disabled'
        : !hasRestricted
          ? 'no restricted tokens'
          : !hasChain
            ? 'no chainId'
            : !hasSubjects
              ? 'no subjects'
              : !publicClient
                ? 'no publicClient'
                : 'unknown'
    console.log('[useRestrictedTokenAllowlistChecks] Address checks query state', {
      enabled: addressChecksEnabled,
      enabledReason,
      hasRestricted,
      hasChain,
      hasSubjects,
      publicClient: !!publicClient,
      restrictedTokenAddresses: restrictedTokenAddresses.length,
      restrictedTokenKey,
      subjectAddresses: allSubjectAddresses.length,
      allSubjectAddressKey,
      chainKey,
      isLoading: addressChecks.isLoading,
      isFetching: addressChecks.isFetching,
      dataLength: addressChecks.data?.length ?? 0,
      hasData: !!addressChecks.data,
    })
  }

  // Combine all check results - ensure we always get data when queries are enabled
  const allChecks = useMemo(() => {
    const walletResults = walletChecks.data ?? []
    const addressResults = addressChecks.data ?? []
    const combined = [...walletResults, ...addressResults]

    if (process.env.NODE_ENV !== 'production') {
      console.log('[useRestrictedTokenAllowlistChecks] Combining check results', {
        walletResults: walletResults.length,
        addressResults: addressResults.length,
        combined: combined.length,
        walletQueryEnabled: walletChecksEnabled,
        walletQueryHasData: !!walletChecks.data,
        walletQueryIsLoading: walletChecks.isLoading,
        walletQueryIsFetching: walletChecks.isFetching,
        addressQueryEnabled: addressChecksEnabled,
        addressQueryHasData: !!addressChecks.data,
        addressQueryIsLoading: addressChecks.isLoading,
        addressQueryIsFetching: addressChecks.isFetching,
      })
    }

    return combined
  }, [
    walletChecks.data,
    addressChecks.data,
    walletChecksEnabled,
    addressChecksEnabled,
    walletChecks.isLoading,
    walletChecks.isFetching,
    addressChecks.isLoading,
    addressChecks.isFetching,
  ])

  // Check if pool exists (for debug info)
  const poolExistsChecks = useQuery({
    queryKey: ['pool-exists-checks', chainId, computedPoolAddresses],
    queryFn: async () => {
      if (!publicClient || computedPoolAddresses.length === 0) {
        return new Map<Address, boolean>()
      }

      const existsMap = new Map<Address, boolean>()
      for (const poolAddress of computedPoolAddresses) {
        const exists = await checkContractExists(poolAddress, publicClient)
        existsMap.set(poolAddress, exists)
      }
      return existsMap
    },
    enabled: enabled && !!publicClient && computedPoolAddresses.length > 0,
    staleTime: 60_000,
    gcTime: 120_000,
  })

  // Build warnings
  const { blockingWarnings, nonBlockingWarnings } = useMemo(() => {
    const blocking: RestrictedTokenAllowlistChecks['blockingWarnings'] = []
    const nonBlocking: RestrictedTokenAllowlistChecks['nonBlockingWarnings'] = []

    for (const check of allChecks) {
      if (check.isAllowed === false) {
        // Not allowed - blocking warning
        blocking.push({
          tokenAddress: check.tokenAddress,
          tokenSymbol: check.tokenSymbol,
          subjectAddress: check.subjectAddress,
          subjectLabel: check.subjectLabel,
          message: `${check.subjectLabel} (${check.subjectAddress}) is not whitelisted for ${check.tokenSymbol || check.tokenAddress}. Ask your system administrator to whitelist this address.`,
        })
      } else if (check.isAllowed === undefined && check.error) {
        // Cannot determine - non-blocking warning
        nonBlocking.push({
          tokenAddress: check.tokenAddress,
          tokenSymbol: check.tokenSymbol,
          subjectAddress: check.subjectAddress,
          subjectLabel: check.subjectLabel,
          message: `Unable to verify if ${check.subjectLabel} (${check.subjectAddress}) is whitelisted for ${check.tokenSymbol || check.tokenAddress}. Contact admin.`,
        })
      }
    }

    // Add special message for pools that don't exist yet
    if (poolExistsChecks.data) {
      for (const poolAddress of computedPoolAddresses) {
        const exists = poolExistsChecks.data.get(poolAddress)
        if (exists === false) {
          // Find checks for this pool
          const poolChecks = allChecks.filter((c) => c.subjectAddress === poolAddress)
          for (const check of poolChecks) {
            if (check.isAllowed === false || check.isAllowed === undefined) {
              blocking.push({
                tokenAddress: check.tokenAddress,
                tokenSymbol: check.tokenSymbol,
                subjectAddress: poolAddress,
                subjectLabel: 'Pool',
                message: `Pool address will be: ${poolAddress} (deterministic). This address must be whitelisted before trading or adding liquidity.`,
              })
            }
          }
        }
      }
    }

    return { blockingWarnings: blocking, nonBlockingWarnings: nonBlocking }
  }, [allChecks, poolExistsChecks.data, computedPoolAddresses])

  const isBlocked = blockingWarnings.length > 0
  const isLoading =
    walletChecks.isLoading ||
    walletChecks.isFetching ||
    addressChecks.isLoading ||
    addressChecks.isFetching ||
    poolExistsChecks.isLoading

  // Compute quoterAllowed status and notAllowedSubjects
  const { quoterAllowed, notAllowedSubjects } = useMemo(() => {
    const quoterChecks = allChecks.filter((c) => c.subjectLabel === 'Quoter')
    const subjects: RestrictedTokenAllowlistChecks['notAllowedSubjects'] = []

    // Check quoter status
    let quoterAllowedValue: boolean | undefined
    if (quoterChecks.length > 0) {
      // If any quoter check is false, quoter is not allowed
      const anyNotAllowed = quoterChecks.some((c) => c.isAllowed === false)
      const allAllowed = quoterChecks.every((c) => c.isAllowed === true)
      quoterAllowedValue = anyNotAllowed ? false : allAllowed ? true : undefined
    }

    // Build notAllowedSubjects array
    for (const check of allChecks) {
      if (check.isAllowed === false) {
        let type: RestrictedTokenAllowlistChecks['notAllowedSubjects'][0]['type']
        if (check.subjectLabel === 'Wallet') {
          type = 'wallet'
        } else if (check.subjectLabel === 'Permit2') {
          type = 'permit2'
        } else if (check.subjectLabel === 'Swap Router') {
          type = 'swapRouter'
        } else if (check.subjectLabel === 'Position Manager') {
          type = 'positionManager'
        } else if (check.subjectLabel === 'Pool' || check.subjectLabel.startsWith('Pool ')) {
          type = 'pool'
        } else if (check.subjectLabel === 'Quoter') {
          type = 'quoter'
        } else {
          continue // Skip unknown subjects
        }

        subjects.push({
          type,
          address: check.subjectAddress,
          token: check.tokenAddress,
          tokenSymbol: check.tokenSymbol,
        })
      }
    }

    return { quoterAllowed: quoterAllowedValue, notAllowedSubjects: subjects }
  }, [allChecks])

  // Debug logging
  if (process.env.NODE_ENV !== 'production') {
    console.log('[useRestrictedTokenAllowlistChecks] Final Status', {
      flow,
      enabled,
      restrictedTokens: restrictedTokens.length,
      restrictedTokenAddresses,
      restrictedTokenKey,
      allSubjectAddresses: allSubjectAddresses.length,
      subjectAddresses: allSubjectAddresses.map((a) => `${a.label}:${a.address}`),
      allSubjectAddressKey,
      walletChecksEnabled,
      walletChecksQueryState: {
        enabled: walletChecksEnabled,
        isLoading: walletChecks.isLoading,
        isFetching: walletChecks.isFetching,
        hasData: !!walletChecks.data,
        dataLength: walletChecks.data?.length ?? 0,
      },
      addressChecksEnabled,
      addressChecksQueryState: {
        enabled: addressChecksEnabled,
        isLoading: addressChecks.isLoading,
        isFetching: addressChecks.isFetching,
        hasData: !!addressChecks.data,
        dataLength: addressChecks.data?.length ?? 0,
      },
      allChecks: allChecks.length,
      allChecksDetails: allChecks,
      blockingWarnings: blockingWarnings.length,
      nonBlockingWarnings: nonBlockingWarnings.length,
      isBlocked,
      isLoading,
      poolAddresses: computedPoolAddresses,
      poolExists: poolExistsChecks.data ? Object.fromEntries(poolExistsChecks.data) : undefined,
    })
  }

  return {
    blockingWarnings,
    nonBlockingWarnings,
    isBlocked,
    isLoading,
    quoterAllowed,
    notAllowedSubjects,
    debug: {
      checked: allChecks,
      restrictedTokens,
    },
  }
}
