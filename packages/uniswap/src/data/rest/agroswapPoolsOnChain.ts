/**
 * On-chain pool querying utilities for Agroswap factory contracts
 * This can be replaced with subgraph queries (e.g., Goldsky) later
 */

import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { decodeEventLog, type Log, PublicClient } from 'viem'

// Factory deployment blocks for each chain (optimization: start querying from deployment block)
// These should be set to the block number when the factory was deployed
// You can find this by checking the factory contract's creation transaction on a block explorer
//
// AGROSWAP: To find the deployment block for Base Sepolia factory (0xB1285002ce1173097A7E2A1a0aCa00fBb436370d):
// 1. Visit https://sepolia.basescan.org/address/0xB1285002ce1173097A7E2A1a0aCa00fBb436370d
// 2. Click on the "Contract Creation" transaction
// 3. Note the block number from that transaction
// 4. Set it below to improve query performance and avoid chunking
//
// If not set, chunking will handle large block ranges automatically (see getLogsChunked)
const FACTORY_DEPLOYMENT_BLOCKS: Partial<Record<UniverseChainId, bigint>> = {
  // Base Sepolia factory: 0xB1285002ce1173097A7E2A1a0aCa00fBb436370d
  // Example: [UniverseChainId.BaseSepolia]: 12345678n, // Set actual deployment block here
} as Partial<Record<UniverseChainId, bigint>>

/**
 * Maximum block range for eth_getLogs queries
 * Most RPC providers limit this to 100,000 blocks
 */
const MAX_BLOCK_RANGE = 90000n // Use 90k to stay safely under 100k limit

/**
 * Chunk large block ranges into smaller requests to avoid RPC limits
 * Most RPC providers limit eth_getLogs to ~100,000 blocks per request
 */
async function getLogsChunked(
  publicClient: PublicClient,
  params: {
    address: `0x${string}`
    event: (typeof V3_FACTORY_ABI)[0]
    fromBlock: bigint
    toBlock: bigint
  },
): Promise<Log[]> {
  const { address, event, fromBlock, toBlock } = params
  const range = toBlock - fromBlock

  // If range is within limit, make single request
  if (range <= MAX_BLOCK_RANGE) {
    return await publicClient.getLogs({
      address,
      event,
      fromBlock,
      toBlock,
    })
  }

  // Chunk the range into multiple requests
  const chunks: Array<{ fromBlock: bigint; toBlock: bigint }> = []
  let currentFrom = fromBlock

  while (currentFrom <= toBlock) {
    const currentTo = currentFrom + MAX_BLOCK_RANGE > toBlock ? toBlock : currentFrom + MAX_BLOCK_RANGE
    chunks.push({ fromBlock: currentFrom, toBlock: currentTo })
    currentFrom = currentTo + 1n
  }

  // Make parallel requests for all chunks
  const chunkPromises = chunks.map((chunk) =>
    publicClient.getLogs({
      address,
      event,
      fromBlock: chunk.fromBlock,
      toBlock: chunk.toBlock,
    }),
  )

  const chunkResults = await Promise.all(chunkPromises)

  // Merge all results
  return chunkResults.flat()
}

/**
 * Query the factory contract's deployment block by checking its creation transaction
 * This is a one-time operation - the result can be cached
 */
async function getFactoryDeploymentBlock(
  publicClient: PublicClient,
  factoryAddress: `0x${string}`,
): Promise<bigint | null> {
  try {
    // Get the contract's code to verify it exists
    const code = await publicClient.getBytecode({ address: factoryAddress })
    if (!code || code === '0x') {
      return null
    }

    // Try to find the creation transaction by checking recent blocks
    // This is a simplified approach - in production, you might want to use a block explorer API
    // or query the contract's creation transaction hash if known
    const currentBlock = await publicClient.getBlockNumber()

    // Search backwards from current block (limit to last 10,000 blocks for performance)
    const searchLimit = 10000n
    const startBlock = currentBlock > searchLimit ? currentBlock - searchLimit : 0n

    // For now, return null and let the caller set it manually
    // In production, you could implement a binary search or use block explorer API
    return null
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error querying factory deployment block:', error)
    }
    return null
  }
}

// Cache keys for storing query state
const getBlockCacheKey = (chainId: UniverseChainId, factoryAddress: string) =>
  `agroswap-pools-last-block-${chainId}-${factoryAddress.toLowerCase()}`

const getPoolsCacheKey = (chainId: UniverseChainId, factoryAddress: string) =>
  `agroswap-pools-addresses-${chainId}-${factoryAddress.toLowerCase()}`

/**
 * Get the last queried block from cache
 */
function getLastQueriedBlock(chainId: UniverseChainId, factoryAddress: string): bigint | null {
  if (typeof window === 'undefined') return null

  try {
    const cached = localStorage.getItem(getBlockCacheKey(chainId, factoryAddress))
    if (cached) {
      const blockNumber = BigInt(cached)
      return blockNumber
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Error reading cached block number:', error)
    }
  }
  return null
}

/**
 * Cache the last queried block
 */
function setLastQueriedBlock(chainId: UniverseChainId, factoryAddress: string, blockNumber: bigint): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(getBlockCacheKey(chainId, factoryAddress), blockNumber.toString())
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Error caching block number:', error)
    }
  }
}

/**
 * Get cached pool addresses
 */
function getCachedPoolAddresses(chainId: UniverseChainId, factoryAddress: string): Set<string> {
  if (typeof window === 'undefined') return new Set()

  try {
    const cached = localStorage.getItem(getPoolsCacheKey(chainId, factoryAddress))
    if (cached) {
      const addresses = JSON.parse(cached) as string[]
      return new Set(addresses)
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Error reading cached pool addresses:', error)
    }
  }
  return new Set()
}

/**
 * Cache pool addresses
 */
function setCachedPoolAddresses(chainId: UniverseChainId, factoryAddress: string, addresses: string[]): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(getPoolsCacheKey(chainId, factoryAddress), JSON.stringify(addresses))
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Error caching pool addresses:', error)
    }
  }
}

/**
 * Clear cached pool data for a chain (useful for debugging or when factory is redeployed)
 */
export function clearPoolCache(chainId: UniverseChainId, factoryAddress: string): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(getBlockCacheKey(chainId, factoryAddress))
    localStorage.removeItem(getPoolsCacheKey(chainId, factoryAddress))
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Error clearing pool cache:', error)
    }
  }
}

// V3 Factory ABI (for PoolCreated event)
const V3_FACTORY_ABI = [
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
    ],
  },
] as const

// V3 Pool ABI
const V3_POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { internalType: 'int24', name: 'tick', type: 'int24' },
      { internalType: 'uint16', name: 'observationIndex', type: 'uint16' },
      { internalType: 'uint16', name: 'observationCardinality', type: 'uint16' },
      { internalType: 'uint16', name: 'observationCardinalityNext', type: 'uint16' },
      { internalType: 'uint8', name: 'feeProtocol', type: 'uint8' },
      { internalType: 'bool', name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint24', name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ERC20 ABI for token metadata
const ERC20_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface OnChainPoolData {
  poolAddress: string
  token0: {
    address: string
    symbol: string
    name: string
    decimals: number
    balance: string
  }
  token1: {
    address: string
    symbol: string
    name: string
    decimals: number
    balance: string
  }
  fee: number
  feeTier: number
  tickSpacing: number
  sqrtPriceX96: string
  tick: number
  liquidity: string
  tvlUSD: number // Will be calculated or fetched from price oracle
  volume24hUSD: number // Will be 0 for now, can be fetched from events or subgraph
}

/**
 * Query all pools created by the factory contract
 *
 * Performance optimizations:
 * 1. Caches last queried block to avoid re-scanning events from block 0
 * 2. Uses factory deployment block as starting point (if set) to avoid scanning from genesis
 * 3. Filters out pools with liquidity === 0 (only returns active pools)
 *
 * Note: Pool data (TVL, liquidity) is always fetched fresh to ensure accurate values.
 * Only the event scanning is optimized with caching.
 *
 * TODO: Replace with subgraph query (e.g., Goldsky) for better performance
 */
export async function queryFactoryPools(
  publicClient: PublicClient,
  factoryAddress: `0x${string}`,
  chainId: UniverseChainId,
): Promise<OnChainPoolData[]> {
  try {
    // Get current block number
    const currentBlock = await publicClient.getBlockNumber()

    // Determine starting block using optimizations:
    // 1. Use cached last queried block (most efficient - only queries new pools)
    // 2. Fall back to factory deployment block (avoids scanning from genesis)
    // 3. Fall back to block 0 if neither is available (slow but works)
    const cachedLastBlock = getLastQueriedBlock(chainId, factoryAddress)
    const cachedPoolAddresses = getCachedPoolAddresses(chainId, factoryAddress)
    const deploymentBlock = FACTORY_DEPLOYMENT_BLOCKS[chainId]

    // Determine if this is an incremental query (we have cached pools) or full query
    const hasCachedPools = cachedPoolAddresses.size > 0
    const hasCachedBlock = cachedLastBlock !== null

    let fromBlock: bigint
    let isInitialQuery = false

    if (hasCachedPools && hasCachedBlock && cachedLastBlock! < currentBlock) {
      // Incremental query: only get new pools since last query
      // This is the fastest - only queries new pools created since last query
      fromBlock = cachedLastBlock! + 1n
    } else {
      // Full query: need to scan from deployment block (or 0) to get all pools
      // This happens on first query, or if cache was cleared
      if (deploymentBlock) {
        fromBlock = deploymentBlock
      } else {
        // Fall back to block 0 (slow but works)
        // Consider setting FACTORY_DEPLOYMENT_BLOCKS to improve performance
        fromBlock = 0n
      }
      isInitialQuery = true
      // Clear any stale cache when doing a full query
      if (hasCachedBlock || hasCachedPools) {
        clearPoolCache(chainId, factoryAddress)
      }
    }

    // Query PoolCreated events from factory
    // AGROSWAP: Use chunked queries to avoid RPC "max block range" errors
    // Most RPC providers limit eth_getLogs to ~100,000 blocks per request
    const blockRange = currentBlock - fromBlock
    if (process.env.NODE_ENV !== 'production' && blockRange > MAX_BLOCK_RANGE) {
      console.log(
        `[AGROSWAP] Large block range detected: ${blockRange} blocks. Using chunked queries (max ${MAX_BLOCK_RANGE} per chunk)`,
      )
    }

    const logs = await getLogsChunked(publicClient, {
      address: factoryAddress,
      event: V3_FACTORY_ABI[0],
      fromBlock,
      toBlock: currentBlock,
    })

    // Cache the current block for next query (only if we got results or it's an initial query)
    // This ensures we don't skip blocks if the query failed
    if (logs.length > 0 || isInitialQuery) {
      setLastQueriedBlock(chainId, factoryAddress, currentBlock)
    }

    // Extract unique pool addresses from events
    const newPoolAddresses = Array.from(
      new Set(
        logs
          .map((log) => {
            try {
              const decoded = decodeEventLog({
                abi: V3_FACTORY_ABI,
                data: log.data,
                topics: log.topics,
              })
              if (decoded.eventName === 'PoolCreated' && 'pool' in decoded.args) {
                return (decoded.args.pool as `0x${string}`).toLowerCase()
              }
            } catch (error) {
              // Skip logs that can't be decoded
              return null
            }
            return null
          })
          .filter((addr): addr is string => addr !== null),
      ),
    )

    // Merge with cached pool addresses (for incremental queries)
    // On first query (isInitialQuery), cached will be empty, so we use only new pools
    // On subsequent queries, we merge new pools with cached ones
    const allPoolAddresses = isInitialQuery
      ? newPoolAddresses // First query: only use pools from events
      : Array.from(new Set([...cachedPoolAddresses, ...newPoolAddresses])) // Incremental: merge with cached

    // Update cache with all pool addresses
    if (allPoolAddresses.length > 0) {
      setCachedPoolAddresses(chainId, factoryAddress, allPoolAddresses)
    }

    // Fetch pool data for each pool (only pools with liquidity > 0 are returned)
    // Note: We fetch data for ALL pools (cached + new) to get fresh TVL/liquidity values
    const poolDataPromises = allPoolAddresses.map((poolAddress) =>
      fetchPoolData(publicClient, poolAddress as `0x${string}`, chainId),
    )

    const poolDataResults = await Promise.allSettled(poolDataPromises)
    const pools: OnChainPoolData[] = []

    for (const result of poolDataResults) {
      if (result.status === 'fulfilled' && result.value) {
        // fetchPoolData already filters out pools with liquidity === 0
        // Double-check here to be safe
        if (result.value.liquidity !== '0' && BigInt(result.value.liquidity) > 0n) {
          pools.push(result.value)
        }
      }
    }

    // Sort by TVL descending (or liquidity if TVL is 0)
    return pools.sort((a, b) => {
      // If TVL is available, sort by TVL
      if (a.tvlUSD > 0 || b.tvlUSD > 0) {
        return b.tvlUSD - a.tvlUSD
      }
      // Otherwise, sort by liquidity as fallback
      return BigInt(b.liquidity) > BigInt(a.liquidity) ? 1 : -1
    })
  } catch (error) {
    // AGROSWAP: Enhanced error logging for debugging
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (process.env.NODE_ENV !== 'production') {
      console.error('[AGROSWAP] Error querying factory pools:', {
        error: errorMessage,
        chainId,
        factoryAddress,
        fromBlock: fromBlock?.toString(),
        toBlock: currentBlock?.toString(),
        blockRange: currentBlock && fromBlock ? (currentBlock - fromBlock).toString() : 'unknown',
      })
    }

    // If error is related to block range, log a helpful message
    if (errorMessage.includes('max block range') || errorMessage.includes('query exceeds')) {
      console.warn(
        `[AGROSWAP] Block range error detected. Consider setting FACTORY_DEPLOYMENT_BLOCKS[${chainId}] to a more recent block number to reduce query range.`,
      )
    }

    return []
  }
}

/**
 * Fetch detailed data for a single pool
 */
async function fetchPoolData(
  publicClient: PublicClient,
  poolAddress: `0x${string}`,
  chainId: UniverseChainId,
): Promise<OnChainPoolData | null> {
  try {
    // Fetch pool state
    const [slot0Result, liquidityResult, token0Result, token1Result, feeResult] = await Promise.all([
      publicClient
        .readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'slot0',
        })
        .catch(() => null),
      publicClient
        .readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'liquidity',
        })
        .catch(() => null),
      publicClient
        .readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'token0',
        })
        .catch(() => null),
      publicClient
        .readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'token1',
        })
        .catch(() => null),
      publicClient
        .readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'fee',
        })
        .catch(() => null),
    ])

    // Validate all required results are present
    if (
      !slot0Result ||
      !liquidityResult ||
      !token0Result ||
      !token1Result ||
      feeResult === null ||
      feeResult === undefined
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[AGROSWAP] fetchPoolData: Missing required pool data', {
          poolAddress,
          hasSlot0: !!slot0Result,
          hasLiquidity: liquidityResult !== null && liquidityResult !== undefined,
          hasToken0: !!token0Result,
          hasToken1: !!token1Result,
          hasFee: feeResult !== null && feeResult !== undefined,
        })
      }
      return null
    }

    // Validate slot0Result structure (must have sqrtPriceX96 and tick)
    if (
      typeof slot0Result !== 'object' ||
      !('sqrtPriceX96' in slot0Result) ||
      !('tick' in slot0Result) ||
      slot0Result.sqrtPriceX96 === null ||
      slot0Result.sqrtPriceX96 === undefined ||
      slot0Result.tick === null ||
      slot0Result.tick === undefined
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[AGROSWAP] fetchPoolData: Invalid slot0Result structure', {
          poolAddress,
          slot0Result,
        })
      }
      return null
    }

    // Check if pool has liquidity
    if (liquidityResult === 0n || slot0Result.sqrtPriceX96 === 0n) {
      return null
    }

    // Fetch token metadata and balances
    const [token0Metadata, token1Metadata, token0Balance, token1Balance] = await Promise.all([
      fetchTokenMetadata(publicClient, token0Result),
      fetchTokenMetadata(publicClient, token1Result),
      publicClient.readContract({
        address: token0Result,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [poolAddress],
      }),
      publicClient.readContract({
        address: token1Result,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [poolAddress],
      }),
    ])

    if (!token0Metadata || !token1Metadata) {
      return null
    }

    // Calculate TVL
    // TODO: Integrate with price oracle (e.g., CoinGecko, Uniswap price API) to calculate USD value
    // For now, using 0 as placeholder. When subgraph is integrated, this will come from there
    const tvlUSD = 0

    // Safely convert values with validation
    const sqrtPriceX96Bigint = slot0Result.sqrtPriceX96
    const tickNumber = slot0Result.tick
    const feeNumber = typeof feeResult === 'bigint' || typeof feeResult === 'number' ? Number(feeResult) : null
    const liquidityBigint = liquidityResult

    // Final validation before returning
    if (
      sqrtPriceX96Bigint === null ||
      sqrtPriceX96Bigint === undefined ||
      tickNumber === null ||
      tickNumber === undefined ||
      feeNumber === null ||
      liquidityBigint === null ||
      liquidityBigint === undefined
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[AGROSWAP] fetchPoolData: Invalid values after conversion', {
          poolAddress,
          sqrtPriceX96: sqrtPriceX96Bigint,
          tick: tickNumber,
          fee: feeNumber,
          liquidity: liquidityBigint,
        })
      }
      return null
    }

    return {
      poolAddress,
      token0: {
        address: token0Result,
        symbol: token0Metadata.symbol,
        name: token0Metadata.name,
        decimals: token0Metadata.decimals,
        balance: typeof token0Balance === 'bigint' ? token0Balance.toString() : String(token0Balance ?? '0'),
      },
      token1: {
        address: token1Result,
        symbol: token1Metadata.symbol,
        name: token1Metadata.name,
        decimals: token1Metadata.decimals,
        balance: typeof token1Balance === 'bigint' ? token1Balance.toString() : String(token1Balance ?? '0'),
      },
      fee: feeNumber,
      feeTier: feeNumber,
      tickSpacing: 60, // Default for V3, can be fetched if needed
      sqrtPriceX96: typeof sqrtPriceX96Bigint === 'bigint' ? sqrtPriceX96Bigint.toString() : String(sqrtPriceX96Bigint),
      tick: Number(tickNumber),
      liquidity: typeof liquidityBigint === 'bigint' ? liquidityBigint.toString() : String(liquidityBigint),
      tvlUSD,
      volume24hUSD: 0, // TODO: Calculate from Swap events or use subgraph
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error fetching pool data for ${poolAddress}:`, error)
    }
    return null
  }
}

/**
 * Fetch token metadata (symbol, name, decimals)
 */
async function fetchTokenMetadata(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'name',
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }),
    ])

    return {
      symbol: symbol as string,
      name: name as string,
      decimals: Number(decimals),
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error fetching token metadata for ${tokenAddress}:`, error)
    }
    return null
  }
}

/**
 * Query pools from Goldsky subgraph
 * TODO: Implement Goldsky subgraph integration
 *
 * This function signature matches OnChainPoolData so the rest of the code doesn't need to change
 * when switching from on-chain to subgraph queries.
 *
 * Example subgraph query structure:
 * ```graphql
 * query TopPools($chainId: BigInt!, $first: Int!) {
 *   pools(
 *     where: { chainId: $chainId }
 *     orderBy: totalValueLockedUSD
 *     orderDirection: desc
 *     first: $first
 *   ) {
 *     id
 *     token0 { id symbol name decimals }
 *     token1 { id symbol name decimals }
 *     feeTier
 *     totalValueLockedUSD
 *     volumeUSD
 *     ...
 *   }
 * }
 * ```
 */
export async function queryPoolsFromSubgraph(
  chainId: UniverseChainId,
  // Add subgraph-specific parameters here (e.g., first: number, skip: number)
): Promise<OnChainPoolData[]> {
  // Placeholder for future Goldsky subgraph integration
  // The return type matches OnChainPoolData so the rest of the code doesn't need to change
  throw new Error('Subgraph integration not yet implemented. Use queryFactoryPools for on-chain queries.')
}
