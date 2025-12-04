/**
 * Carbon Registry Counterpart Token Detection
 * 
 * Queries the Carbon Registry contract to get the counterpart token for a Carbon token.
 * This is used for routing Carbon tokens through their counterpart pairs.
 */

import { Token } from '@uniswap/sdk-core'
import { PublicClient } from 'viem'
import { Interface } from 'ethers/lib/utils'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { logger } from 'utilities/src/logger/logger'

/**
 * Carbon Registry ABI - counterpartOf function
 */
const CARBON_REGISTRY_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'carbonToken', type: 'address' }],
    name: 'counterpartOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

/**
 * ERC20 ABI for fetching token metadata
 */
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
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
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
] as const

/**
 * Cache for counterpart token lookups
 * Key: `${chainId}:${carbonTokenAddress}`
 */
const counterpartTokenCache = new Map<string, Token | null>()

/**
 * Get Carbon Registry contract address for a chain
 * TODO: Replace with actual Carbon Registry addresses per chain
 */
function getCarbonRegistryAddress(chainId: EVMUniverseChainId): string {
  // Placeholder addresses - replace with actual Carbon Registry addresses
  const registryAddresses: Record<number, string> = {
    84532: '0x0000000000000000000000000000000000000000', // Base Sepolia - REPLACE
    8453: '0x0000000000000000000000000000000000000000', // Base - REPLACE
    137: '0x0000000000000000000000000000000000000000', // Polygon - REPLACE
  }

  const address = registryAddresses[chainId]
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Carbon Registry address not configured for chain ${chainId}`)
  }

  return address
}

/**
 * Check if a token address is a Carbon token by querying the registry
 */
async function isCarbonToken(
  tokenAddress: string,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<boolean> {
  try {
    const registryAddress = getCarbonRegistryAddress(chainId) as `0x${string}`
    const registryInterface = new Interface(CARBON_REGISTRY_ABI)

    // Try to get counterpart - if it returns a non-zero address, it's a Carbon token
    const callData = registryInterface.encodeFunctionData('counterpartOf', [tokenAddress as `0x${string}`]) as `0x${string}`

    const result = await publicClient.call({
      to: registryAddress,
      data: callData,
    })

    if (!result.data) {
      return false
    }

    const decoded = registryInterface.decodeFunctionResult('counterpartOf', result.data)
    const counterpartAddress = decoded[0] as string

    // If counterpart is non-zero, it's a Carbon token
    return counterpartAddress !== '0x0000000000000000000000000000000000000000'
  } catch (error) {
    // If query fails, assume it's not a Carbon token
    return false
  }
}

/**
 * Fetch ERC20 token metadata (symbol, decimals, name)
 */
async function fetchTokenMetadata(
  tokenAddress: string,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<{ symbol: string; decimals: number; name: string } | null> {
  try {
    const erc20Interface = new Interface(ERC20_ABI)
    const tokenAddressTyped = tokenAddress as `0x${string}`

    const [symbolData, decimalsData, nameData] = await Promise.all([
      publicClient.call({
        to: tokenAddressTyped,
        data: erc20Interface.encodeFunctionData('symbol') as `0x${string}`,
      }),
      publicClient.call({
        to: tokenAddressTyped,
        data: erc20Interface.encodeFunctionData('decimals') as `0x${string}`,
      }),
      publicClient.call({
        to: tokenAddressTyped,
        data: erc20Interface.encodeFunctionData('name') as `0x${string}`,
      }),
    ])

    if (!symbolData.data || !decimalsData.data || !nameData.data) {
      return null
    }

    const symbol = erc20Interface.decodeFunctionResult('symbol', symbolData.data)[0] as string
    const decimals = Number(erc20Interface.decodeFunctionResult('decimals', decimalsData.data)[0])
    const name = erc20Interface.decodeFunctionResult('name', nameData.data)[0] as string

    return { symbol, decimals, name }
  } catch (error) {
    logger.error(error, {
      tags: {
        file: 'getCounterpartToken',
        function: 'fetchTokenMetadata',
      },
      extra: {
        tokenAddress,
        chainId,
      },
    })
    return null
  }
}

/**
 * Get the counterpart token for a Carbon token from the Carbon Registry
 * 
 * @param carbonToken - The Carbon token to get counterpart for
 * @param chainId - Chain ID
 * @param publicClient - Viem public client for on-chain calls
 * @returns Counterpart token or null if not found/not a Carbon token
 */
export async function getCarbonCounterpartToken(
  carbonToken: Token,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<Token | null> {
  const cacheKey = `${chainId}:${carbonToken.address.toLowerCase()}`
  
  // Check cache first
  if (counterpartTokenCache.has(cacheKey)) {
    return counterpartTokenCache.get(cacheKey) ?? null
  }

  try {
    // Check if token is a Carbon token
    const isCarbon = await isCarbonToken(carbonToken.address, chainId, publicClient)
    if (!isCarbon) {
      counterpartTokenCache.set(cacheKey, null)
      return null
    }

    // Get counterpart address from registry
    const registryAddress = getCarbonRegistryAddress(chainId) as `0x${string}`
    const registryInterface = new Interface(CARBON_REGISTRY_ABI)

    const callData = registryInterface.encodeFunctionData('counterpartOf', [
      carbonToken.address as `0x${string}`,
    ]) as `0x${string}`

    const result = await publicClient.call({
      to: registryAddress,
      data: callData,
    })

    if (!result.data) {
      counterpartTokenCache.set(cacheKey, null)
      return null
    }

    const decoded = registryInterface.decodeFunctionResult('counterpartOf', result.data)
    const counterpartAddress = decoded[0] as string

    if (counterpartAddress === '0x0000000000000000000000000000000000000000') {
      counterpartTokenCache.set(cacheKey, null)
      return null
    }

    // Fetch counterpart token metadata
    const metadata = await fetchTokenMetadata(counterpartAddress, chainId, publicClient)
    if (!metadata) {
      counterpartTokenCache.set(cacheKey, null)
      return null
    }

    // Create Token instance
    const counterpartToken = new Token(
      chainId,
      counterpartAddress,
      metadata.decimals,
      metadata.symbol,
      metadata.name,
    )

    // Cache result
    counterpartTokenCache.set(cacheKey, counterpartToken)

    return counterpartToken
  } catch (error) {
    logger.error(error, {
      tags: {
        file: 'getCounterpartToken',
        function: 'getCarbonCounterpartToken',
      },
      extra: {
        carbonTokenAddress: carbonToken.address,
        chainId,
      },
    })

    counterpartTokenCache.set(cacheKey, null)
    return null
  }
}

/**
 * Clear the counterpart token cache (useful for testing or when registry updates)
 */
export function clearCounterpartTokenCache(): void {
  counterpartTokenCache.clear()
}


