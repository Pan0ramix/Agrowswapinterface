/**
 * On-Chain Collectable Fees Hook
 *
 * Simulates NonfungiblePositionManager.collect() to get collectable fee amounts
 * without Trading API or subgraph dependency.
 *
 * Uses viem simulateContract to call collect() with MaxUint128 for amount0Max/amount1Max.
 * The return values represent the collectable amounts now.
 *
 * NEVER returns fake zeros on failure - returns undefined data and error state instead.
 */

import { skipToken, useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount, NONFUNGIBLE_POSITION_MANAGER_ADDRESSES, Token } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { getPositionManagerAddress } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'
import { erc20Abi, type PublicClient } from 'viem'

/**
 * NonfungiblePositionManager ABIs (positions + collect)
 */
const POSITIONS_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'positions',
    outputs: [
      { internalType: 'uint96', name: 'nonce', type: 'uint96' },
      { internalType: 'address', name: 'operator', type: 'address' },
      { internalType: 'address', name: 'token0', type: 'address' },
      { internalType: 'address', name: 'token1', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'int24', name: 'tickLower', type: 'int24' },
      { internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { internalType: 'uint256', name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { internalType: 'uint128', name: 'tokensOwed0', type: 'uint128' },
      { internalType: 'uint128', name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const COLLECT_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint128', name: 'amount0Max', type: 'uint128' },
          { internalType: 'uint128', name: 'amount1Max', type: 'uint128' },
        ],
        internalType: 'struct INonfungiblePositionManager.CollectParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'collect',
    outputs: [
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

/**
 * Max uint128 value (for amount0Max/amount1Max in collect call)
 */
const MAX_UINT128 = (1n << 128n) - 1n

/**
 * Parsed collect() simulation result
 */
export interface CollectableFeesData {
  amount0: CurrencyAmount<Currency>
  amount1: CurrencyAmount<Currency>
  token0: Currency
  token1: Currency
}

/**
 * Parameters for fetching collectable fees
 */
export interface UseOnChainCollectableFeesParams {
  chainId: EVMUniverseChainId | undefined
  positionManagerAddress?: string // Optional override
  tokenId: string | undefined
  account: string | undefined // Wallet address (used as recipient in simulation)
  token0Fallback?: Currency | undefined // Fallback if positions() fails
  token1Fallback?: Currency | undefined // Fallback if positions() fails
  enabled?: boolean
  refetchIntervalMs?: number // Optional: refetch interval when modal is open
}

/**
 * Return type for collectable fees hook
 * NEVER returns fake zeros - returns undefined data on failure
 */
export interface UseOnChainCollectableFeesReturn {
  data?: CollectableFeesData
  isLoading: boolean
  isError: boolean
  error?: Error
  refetch: () => void
}

/**
 * In-memory cache for token metadata (keyed by chainId:address)
 * Reduces RPC calls when the same token is queried multiple times
 */
const tokenMetadataCache = new Map<string, { decimals: number; symbol: string; name: string }>()

/**
 * Normalize address for cache key (lowercase, trimmed, ensures consistency)
 * Exported for testing
 */
export function normalizeAddressKey(address: string): string {
  // Trim whitespace and convert to lowercase
  // This ensures same token with different casing maps to same cache key
  return address.trim().toLowerCase()
}

/**
 * Cache key for token metadata
 * Exported for testing
 */
export function getTokenMetadataCacheKey(chainId: number, address: string): string {
  return `${chainId}:${normalizeAddressKey(address)}`
}

/**
 * Convert value to BigintIsh (bigint or string)
 * NEVER accepts number - ensures CurrencyAmount.fromRawAmount safety
 *
 * @deprecated Use toBigintIshSafe from fees/utils/bigintish.ts instead
 * Kept for backward compatibility and use in parseCollectResult
 */
function toBigintIsh(x: unknown): bigint {
  if (typeof x === 'bigint') {
    return x
  }
  if (typeof x === 'string') {
    // Handle hex strings and decimal strings
    try {
      return BigInt(x)
    } catch (error) {
      throw new Error(
        `Cannot convert string "${x}" to BigInt: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  // CRITICAL: viem can return numbers in some cases - reject them to prevent CurrencyAmount errors
  // This is the root cause of "Cannot convert 0 to a BigInt" errors
  throw new Error(`Invalid BigintIsh: expected bigint or string, got ${typeof x} (value: ${String(x)})`)
}

/**
 * Robust parser for collect() simulation result
 * Handles both array and object return shapes from viem
 * NEVER returns number - always returns bigint
 *
 * Uses toBigintIsh which rejects numbers to prevent CurrencyAmount.fromRawAmount errors
 *
 * Exported for testing and use in providers
 */
export function parseCollectResult(result: unknown): { amount0: bigint; amount1: bigint } {
  // Handle nested result field (if viem wraps it)
  let unwrappedResult = result
  if (result && typeof result === 'object' && 'result' in result) {
    unwrappedResult = (result as any).result
  }

  // Try array shape: [amount0, amount1]
  if (Array.isArray(unwrappedResult)) {
    if (unwrappedResult.length >= 2) {
      // CRITICAL: Use toBigintIsh which rejects numbers - prevents "Cannot convert 0 to BigInt"
      const amount0Raw = toBigintIsh(unwrappedResult[0])
      const amount1Raw = toBigintIsh(unwrappedResult[1])

      // Validate non-negative
      if (amount0Raw < 0n || amount1Raw < 0n) {
        throw new Error('Invalid collect() result: amounts must be non-negative')
      }

      return { amount0: amount0Raw, amount1: amount1Raw }
    }
    throw new Error(`Invalid collect() result array: expected length >= 2, got ${unwrappedResult.length}`)
  }

  // Try object shape: { amount0, amount1 }
  if (unwrappedResult && typeof unwrappedResult === 'object') {
    const obj = unwrappedResult as any
    if ('amount0' in obj && 'amount1' in obj) {
      // CRITICAL: Use toBigintIsh which rejects numbers - prevents "Cannot convert 0 to BigInt"
      const amount0Raw = toBigintIsh(obj.amount0)
      const amount1Raw = toBigintIsh(obj.amount1)

      // Validate non-negative
      if (amount0Raw < 0n || amount1Raw < 0n) {
        throw new Error('Invalid collect() result: amounts must be non-negative')
      }

      return { amount0: amount0Raw, amount1: amount1Raw }
    }
    throw new Error(
      `Invalid collect() result object: expected { amount0, amount1 }, got keys: ${Object.keys(obj).join(', ')}`,
    )
  }

  throw new Error(`Invalid collect() result type: expected array or object, got ${typeof unwrappedResult}`)
}

/**
 * Safely read a string from an ERC20 contract (symbol/name)
 * Returns undefined on failure (graceful degradation)
 * Exported for testing
 */
export async function safeReadString(
  publicClient: PublicClient,
  tokenAddress: string,
  functionName: 'symbol' | 'name',
): Promise<string | undefined> {
  try {
    const value = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName,
    })
    // Ensure it's a string (some contracts might return bytes32)
    return typeof value === 'string' ? value : undefined
  } catch {
    // Function may not exist, may revert, or return invalid type
    return undefined
  }
}

/**
 * Read decimals from ERC20 contract (REQUIRED)
 * Throws if decimals cannot be read or is invalid
 * Exported for use in fee providers
 */
export async function readDecimalsRequired(publicClient: PublicClient, tokenAddress: string): Promise<number> {
  const value = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: 'decimals',
  })

  // viem may return bigint or number depending on ABI/contract
  const n = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN

  // Validate decimals: must be finite, non-negative, and within uint8 range
  if (!Number.isFinite(n) || n < 0 || n > 255) {
    throw new Error(`Invalid decimals for token ${tokenAddress}: ${String(value)}`)
  }

  return n
}

/**
 * Generate fallback symbol from address (e.g., "0x1234...5678")
 * Exported for testing
 */
export function fallbackSymbol(address: string): string {
  if (address.length < 10) {
    return address
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Fetch ERC20 token metadata on-chain (decimals required; symbol/name optional)
 * Uses in-memory cache to reduce RPC calls
 * Returns null only if decimals fetch fails (hard requirement)
 */
async function fetchTokenMetadata(
  publicClient: PublicClient,
  tokenAddress: string,
  chainId: number,
): Promise<{ symbol: string; decimals: number; name: string } | null> {
  // Check cache first
  const cacheKey = getTokenMetadataCacheKey(chainId, tokenAddress)
  const cached = tokenMetadataCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    // Step 1: Fetch decimals (REQUIRED - fails if this doesn't work)
    const decimals = await readDecimalsRequired(publicClient, tokenAddress)

    // Step 2: Fetch symbol and name (OPTIONAL - graceful fallbacks)
    const [symbol, name] = await Promise.all([
      safeReadString(publicClient, tokenAddress, 'symbol'),
      safeReadString(publicClient, tokenAddress, 'name'),
    ])

    // Construct metadata with fallbacks
    const metadata = {
      decimals,
      symbol: symbol ?? fallbackSymbol(tokenAddress),
      name: name ?? '',
    }

    // Cache for future use
    tokenMetadataCache.set(cacheKey, metadata)

    return metadata
  } catch (error) {
    // Decimals fetch failed - this is a hard requirement
    logger.error(error, {
      tags: { file: 'useOnChainCollectableFees', function: 'fetchTokenMetadata' },
      extra: { tokenAddress, chainId },
    })
    return null
  }
}

/**
 * Convert token address to Currency/Token with on-chain metadata
 * Fetches decimals (required), symbol and name (optional with fallbacks) on-chain
 * Throws if decimals fetch fails (required for CurrencyAmount safety)
 */
async function addressToCurrency(chainId: number, address: string, publicClient: PublicClient): Promise<Token> {
  const metadata = await fetchTokenMetadata(publicClient, address, chainId)

  if (!metadata) {
    throw new Error(`Failed to fetch decimals for token ${address} on chain ${chainId}`)
  }

  return new Token(chainId, address as `0x${string}`, metadata.decimals, metadata.symbol, metadata.name)
}

/**
 * React hook to fetch collectable fees via on-chain collect() simulation
 *
 * Simulates collect() call with MaxUint128 to get current collectable amounts.
 * Fetches token0/token1 from positions(tokenId) for authoritative mapping.
 * Fetches token metadata (decimals required; symbol/name optional with fallbacks) on-chain.
 * NEVER returns fake zeros on failure - returns undefined data and error state.
 *
 * @example
 * ```tsx
 * const { data, isLoading, isError } = useOnChainCollectableFees({
 *   chainId: 84532,
 *   tokenId: '123',
 *   account: '0x...',
 *   refetchIntervalMs: 10000, // Optional: refresh every 10s
 * })
 * ```
 */
export function useOnChainCollectableFees(params: UseOnChainCollectableFeesParams): UseOnChainCollectableFeesReturn {
  const {
    chainId,
    positionManagerAddress,
    tokenId,
    account,
    token0Fallback,
    token1Fallback,
    enabled = true,
    refetchIntervalMs,
  } = params

  // Get position manager address
  const pmAddress = useMemo(() => {
    if (positionManagerAddress) {
      return positionManagerAddress as `0x${string}`
    }
    if (!chainId) {
      return undefined
    }
    try {
      // Try Agroswap addresses first
      if (chainId === 84532) {
        const address =
          AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[
            chainId as keyof typeof AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
          ]
        if (address) {
          return address as `0x${string}`
        }
      }

      // Try v3Addresses override
      const v3Address = getPositionManagerAddress(chainId)
      if (v3Address) {
        return v3Address as `0x${string}`
      }

      // Fall back to SDK addresses
      const sdkAddress =
        NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
      if (!sdkAddress) {
        logger.error(new Error(`Position Manager address not found for chain ${chainId}`), {
          tags: { file: 'useOnChainCollectableFees', function: 'useOnChainCollectableFees' },
          extra: { chainId },
        })
        return undefined
      }
      return sdkAddress as `0x${string}`
    } catch (error) {
      logger.error(error, {
        tags: { file: 'useOnChainCollectableFees', function: 'useOnChainCollectableFees' },
        extra: { chainId },
      })
      return undefined
    }
  }, [chainId, positionManagerAddress])

  // Get public client
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  // Validate tokenId and convert to BigInt safely
  const tokenIdBI = useMemo(() => {
    if (!tokenId || tokenId === '' || tokenId === 'undefined' || tokenId === 'null') {
      return null
    }
    try {
      return BigInt(String(tokenId))
    } catch (error) {
      logger.error(error, {
        tags: { file: 'useOnChainCollectableFees', function: 'useOnChainCollectableFees' },
        extra: { tokenId, note: 'Failed to convert tokenId to BigInt' },
      })
      return null
    }
  }, [tokenId])

  // Build query key
  const queryKey = useMemo(() => {
    if (!chainId || !pmAddress || !tokenIdBI || !account || !publicClient) {
      return skipToken
    }
    return ['collectableFees', chainId, pmAddress, tokenIdBI.toString(), account] as const
  }, [chainId, pmAddress, tokenIdBI, account, publicClient])

  // Query function - fetches positions() for token0/token1, fetches metadata, then simulates collect()
  const queryFn = useMemo(() => {
    if (!chainId || !pmAddress || !tokenIdBI || !account || !publicClient) {
      return skipToken
    }

    return async (): Promise<CollectableFeesData> => {
      try {
        // Step 1: Fetch positions(tokenId) to get authoritative token0/token1 addresses
        let token0Address: string
        let token1Address: string
        let token0: Currency
        let token1: Currency

        try {
          const positionData = await publicClient.readContract({
            address: pmAddress,
            abi: POSITIONS_ABI,
            functionName: 'positions',
            args: [tokenIdBI],
          })

          // positions() returns a tuple:
          // [nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1]
          // Extract token0 and token1 addresses (indices 2 and 3)
          const positionTuple = positionData as readonly [
            bigint, // nonce
            string, // operator
            string, // token0
            string, // token1
            number, // fee
            number, // tickLower
            number, // tickUpper
            bigint, // liquidity
            bigint, // feeGrowthInside0LastX128
            bigint, // feeGrowthInside1LastX128
            bigint, // tokensOwed0
            bigint, // tokensOwed1
          ]
          token0Address = positionTuple[2]
          token1Address = positionTuple[3]

          // Step 1b: Fetch token metadata on-chain (decimals required; symbol/name optional)
          // This is resilient - fees still display even if symbol/name fail
          const [token0Metadata, token1Metadata] = await Promise.all([
            fetchTokenMetadata(publicClient, token0Address, chainId),
            fetchTokenMetadata(publicClient, token1Address, chainId),
          ])

          // Decimals is REQUIRED - fail if missing
          if (!token0Metadata) {
            throw new Error(`Failed to fetch decimals for token0 ${token0Address} on chain ${chainId}`)
          }
          if (!token1Metadata) {
            throw new Error(`Failed to fetch decimals for token1 ${token1Address} on chain ${chainId}`)
          }

          // Construct Token instances with on-chain metadata (symbol/name may be fallbacks)
          token0 = new Token(
            chainId,
            token0Address as `0x${string}`,
            token0Metadata.decimals,
            token0Metadata.symbol,
            token0Metadata.name,
          )
          token1 = new Token(
            chainId,
            token1Address as `0x${string}`,
            token1Metadata.decimals,
            token1Metadata.symbol,
            token1Metadata.name,
          )

          if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
            logger.debug(
              'useOnChainCollectableFees',
              'useOnChainCollectableFees',
              'Fetched token0/token1 from positions() with metadata',
              {
                tokenId: tokenIdBI.toString(),
                token0Address,
                token1Address,
                token0Symbol: token0.symbol,
                token1Symbol: token1.symbol,
                token0Decimals: token0.decimals,
                token1Decimals: token1.decimals,
                token0Name: token0.name,
                token1Name: token1.name,
              },
            )
          }
        } catch (error) {
          // If positions() or metadata fetch fails, use fallback tokens if provided
          if (token0Fallback && token1Fallback) {
            logger.warn(error instanceof Error ? error : new Error(String(error)), {
              tags: { file: 'useOnChainCollectableFees', function: 'useOnChainCollectableFees' },
              extra: {
                chainId,
                tokenId: tokenIdBI.toString(),
                note: 'positions() or metadata fetch failed, using fallback tokens',
              },
            })
            token0 = token0Fallback
            token1 = token1Fallback
          } else {
            // No fallback - rethrow to trigger error state
            throw new Error(
              `Failed to fetch token0/token1 from positions(${tokenIdBI}) or metadata: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }

        // Step 2: Simulate collect() call with MaxUint128
        const simResult = await publicClient.simulateContract({
          address: pmAddress,
          abi: COLLECT_ABI,
          functionName: 'collect',
          args: [
            {
              tokenId: tokenIdBI,
              recipient: account as `0x${string}`,
              amount0Max: MAX_UINT128,
              amount1Max: MAX_UINT128,
            },
          ],
          account: account as `0x${string}`, // Simulate as the account (owner)
        })

        // Step 3: Parse result with robust decoder (handles nested result, array, object shapes)
        const { amount0: amount0Raw, amount1: amount1Raw } = parseCollectResult(simResult.result)

        // Step 4: Create CurrencyAmount instances (amount0Raw and amount1Raw are guaranteed bigint)
        const amount0 = CurrencyAmount.fromRawAmount(token0, amount0Raw)
        const amount1 = CurrencyAmount.fromRawAmount(token1, amount1Raw)

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('useOnChainCollectableFees', 'useOnChainCollectableFees', 'Fetched collectable fees', {
            chainId,
            tokenId: tokenIdBI.toString(),
            amount0Raw: amount0Raw.toString(),
            amount1Raw: amount1Raw.toString(),
            amount0Exact: amount0.toExact(),
            amount1Exact: amount1.toExact(),
            token0: token0.symbol,
            token1: token1.symbol,
          })
        }

        return {
          amount0,
          amount1,
          token0,
          token1,
        }
      } catch (error) {
        // DO NOT return fake zeros - let React Query handle error state
        // Log error for debugging
        logger.error(error, {
          tags: { file: 'useOnChainCollectableFees', function: 'useOnChainCollectableFees' },
          extra: {
            chainId,
            tokenId: tokenIdBI.toString(),
            account,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        })

        // Re-throw to trigger React Query error state
        throw error
      }
    }
  }, [chainId, pmAddress, tokenIdBI, account, publicClient, token0Fallback, token1Fallback])

  // Execute query
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && queryFn !== skipToken && tokenIdBI !== null,
    staleTime: 10_000, // 10 seconds - fees can change frequently
    gcTime: 30_000, // 30 seconds cache
    retry: 2,
    retryDelay: 1000,
    // Optional: live refresh while modal is open
    refetchInterval:
      refetchIntervalMs && enabled && queryFn !== skipToken && tokenIdBI !== null ? refetchIntervalMs : false,
  })

  return {
    data,
    isLoading,
    isError,
    error: isError ? (error instanceof Error ? error : new Error(String(error))) : undefined,
    refetch,
  }
}
