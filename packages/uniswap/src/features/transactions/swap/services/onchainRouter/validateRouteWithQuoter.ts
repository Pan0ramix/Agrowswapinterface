/**
 * Route Validation with QuoterV2
 * 
 * Validates candidate routes by calling QuoterV2 contract.
 * Routes that revert are discarded, only successful quotes are kept.
 */

import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { PublicClient } from 'viem'
import { Interface } from 'ethers/lib/utils'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { CandidateRoute } from './generateCandidateRoutes'
import { getQuoterV2Address, getV3FactoryAddress } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_QUOTER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { QUOTER_ADDRESSES } from '@uniswap/sdk-core'
import { logger } from 'utilities/src/logger/logger'

/**
 * Validated route with quote result
 */
export interface ValidatedRoute {
  route: CandidateRoute
  amountOut: string // Raw amount out from quote
  amountOutCurrency: CurrencyAmount<Currency> // Parsed amount out
  sqrtPriceX96After?: string
  initializedTicksCrossed?: number
  gasEstimate?: string
}

/**
 * QuoterV2 ABI
 */
const QUOTER_V2_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
      { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes', name: 'path', type: 'bytes' },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
    ],
    name: 'quoteExactInput',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160[]', name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { internalType: 'uint32[]', name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const V3_FACTORY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

async function getPoolAddress(
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
): Promise<`0x${string}` | null> {
  const factory = getV3FactoryAddress(chainId)
  if (!factory) {
    return null
  }
  try {
    const pool = (await publicClient.readContract({
      address: factory as `0x${string}`,
      abi: V3_FACTORY_ABI as any,
      functionName: 'getPool',
      args: [tokenIn, tokenOut, BigInt(fee)],
    })) as `0x${string}`

    if (!pool || pool === '0x0000000000000000000000000000000000000000') {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'getPoolAddress', 'No pool for pair/fee', {
          tokenIn,
          tokenOut,
          fee,
          chainId,
        })
      }
      return null
    }
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'getPoolAddress', 'Found pool', {
        tokenIn,
        tokenOut,
        fee,
        chainId,
        pool,
      })
    }
    return pool
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'getPoolAddress', 'Error reading pool', {
        tokenIn,
        tokenOut,
        fee,
        chainId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

/**
 * Get Quoter contract address
 */
function getQuoterAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap addresses first
  if (chainId === 84532) {
    const agroswapAddress = AGROSWAP_QUOTER_ADDRESSES[chainId as keyof typeof AGROSWAP_QUOTER_ADDRESSES]
    if (agroswapAddress) {
      return agroswapAddress
    }
  }

  // Try V3 addresses override
  const v3Address = getQuoterV2Address(chainId)
  if (v3Address) {
    return v3Address
  }

  // Fall back to SDK addresses
  const sdkAddress = QUOTER_ADDRESSES[chainId as keyof typeof QUOTER_ADDRESSES]
  if (!sdkAddress) {
    throw new Error(`Quoter address not found for chain ${chainId}`)
  }
  return sdkAddress
}

/**
 * Encode path for multi-hop quote
 * Format: address | fee | address | fee | address
 */
function encodePath(hops: CandidateRoute['hops']): `0x${string}` {
  let path = '0x'
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]
    // Remove '0x' prefix and pad to 40 characters (20 bytes)
    const address = hop.tokenIn.address.slice(2).toLowerCase().padStart(40, '0')
    path += address

    // Add fee (3 bytes = 6 hex chars)
    const feeHex = hop.fee.toString(16).padStart(6, '0')
    path += feeHex

    // Add last token address
    if (i === hops.length - 1) {
      const lastAddress = hop.tokenOut.address.slice(2).toLowerCase().padStart(40, '0')
      path += lastAddress
    }
  }
  return path as `0x${string}`
}

/**
 * Quote a single hop
 */
async function quoteSingleHop(
  hop: CandidateRoute['hops'][0],
  amountIn: CurrencyAmount<Currency>,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
): Promise<{
  amountOut: string
  sqrtPriceX96After: string
  initializedTicksCrossed: number
  gasEstimate: string
} | null> {
  // Pre-check pool existence to avoid quoter reverts for non-existent fee tiers
  const pool = await getPoolAddress(
    chainId,
    publicClient,
    hop.tokenIn.address as `0x${string}`,
    hop.tokenOut.address as `0x${string}`,
    hop.fee,
  )
  if (!pool) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Skipped: pool does not exist', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  if (amountIn.quotient <= 0n) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Skipped zero amountIn', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  try {
    const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
    const amountInRaw = BigInt(amountIn.quotient.toString())

    // Prefer viem readContract to ensure correct encoding/decoding
    const result = await publicClient.readContract({
      address: quoterAddress,
      abi: QUOTER_V2_ABI as any,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: hop.tokenIn.address as `0x${string}`,
          tokenOut: hop.tokenOut.address as `0x${string}`,
          amountIn: amountInRaw,
          fee: BigInt(hop.fee),
          sqrtPriceLimitX96: 0n,
        },
      ],
    })

    if (!result) {
      return null
    }

    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = result as any

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Single-hop quote succeeded', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        amountOut: amountOut?.toString?.(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        quoterAddress: getQuoterAddress(chainId),
        pool,
      })
    }

    return {
      amountOut: amountOut.toString(),
      sqrtPriceX96After: sqrtPriceX96After.toString(),
      initializedTicksCrossed: Number(initializedTicksCrossed),
      gasEstimate: gasEstimate.toString(),
    }
  } catch (error) {
    // Route doesn't exist or has insufficient liquidity
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Single-hop quote reverted', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        quoterAddress: getQuoterAddress(chainId),
        pool,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

/**
 * Quote a multi-hop route
 */
async function quoteMultiHop(
  route: CandidateRoute,
  amountIn: CurrencyAmount<Currency>,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
): Promise<{
  amountOut: string
  sqrtPriceX96AfterList: string[]
  initializedTicksCrossedList: number[]
  gasEstimate: string
} | null> {
  // Verify all hops have pools; bail early if any hop is missing
  for (const hop of route.hops) {
    const pool = await getPoolAddress(
      chainId,
      publicClient,
      hop.tokenIn.address as `0x${string}`,
      hop.tokenOut.address as `0x${string}`,
      hop.fee,
    )
    if (!pool) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Skipped: pool does not exist', {
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        fee: hop.fee,
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        })
      }
      return null
    }
  }

  if (amountIn.quotient <= 0n) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Skipped zero amountIn', {
        tokenIn: route.hops[0]?.tokenIn.symbol,
        tokenOut: route.hops[route.hops.length - 1]?.tokenOut.symbol,
        tokenInAddress: route.hops[0]?.tokenIn.address,
        tokenOutAddress: route.hops[route.hops.length - 1]?.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        hopCount: route.hops.length,
        fees: route.hops.map((h) => h.fee),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  try {
    const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
    const quoterInterface = new Interface(QUOTER_V2_ABI)

    const path = encodePath(route.hops)
    const amountInRaw = BigInt(amountIn.quotient.toString())

    // Prefer viem readContract for consistent encoding/decoding
    const result = await publicClient.readContract({
      address: quoterAddress,
      abi: QUOTER_V2_ABI as any,
      functionName: 'quoteExactInput',
      args: [path, amountInRaw],
    })

    if (!result) {
      return null
    }

    const [amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate] = result as any

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Multi-hop quote succeeded', {
        tokenIn: route.hops[0]?.tokenIn.symbol,
        tokenOut: route.hops[route.hops.length - 1]?.tokenOut.symbol,
        fees: route.hops.map((h) => h.fee),
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        amountOut: amountOut?.toString?.(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        quoterAddress: getQuoterAddress(chainId),
      })
    }

    return {
      amountOut: amountOut.toString(),
      sqrtPriceX96AfterList: (sqrtPriceX96AfterList as bigint[]).map((p) => p.toString()),
      initializedTicksCrossedList: (initializedTicksCrossedList as bigint[]).map((t) => Number(t)),
      gasEstimate: gasEstimate.toString(),
    }
  } catch (error) {
    // Route doesn't exist or has insufficient liquidity
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Multi-hop quote reverted', {
        tokenIn: route.hops[0]?.tokenIn.symbol,
        tokenOut: route.hops[route.hops.length - 1]?.tokenOut.symbol,
        tokenInAddress: route.hops[0]?.tokenIn.address,
        tokenOutAddress: route.hops[route.hops.length - 1]?.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        hopCount: route.hops.length,
        fees: route.hops.map((h) => h.fee),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        quoterAddress: getQuoterAddress(chainId),
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

/**
 * Validate a route with QuoterV2
 * Returns null if route reverts or fails
 */
export async function validateRouteWithQuoter(
  route: CandidateRoute,
  amountIn: CurrencyAmount<Currency>,
  tokenOut: Currency,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
): Promise<ValidatedRoute | null> {
  try {
    // Single hop route
    if (route.hops.length === 1) {
      const quoteResult = await quoteSingleHop(route.hops[0], amountIn, chainId, publicClient, rpcLabel, rpcOrigin)
      if (!quoteResult) {
        return null
      }

      const amountOutCurrency = CurrencyAmount.fromRawAmount(
        tokenOut,
        quoteResult.amountOut,
      )

      return {
        route,
        amountOut: quoteResult.amountOut,
        amountOutCurrency,
        sqrtPriceX96After: quoteResult.sqrtPriceX96After,
        initializedTicksCrossed: quoteResult.initializedTicksCrossed,
        gasEstimate: quoteResult.gasEstimate,
      }
    }

    // Multi-hop route
    const quoteResult = await quoteMultiHop(route, amountIn, chainId, publicClient, rpcLabel, rpcOrigin)
    if (!quoteResult) {
      return null
    }

    const amountOutCurrency = CurrencyAmount.fromRawAmount(tokenOut, quoteResult.amountOut)

    return {
      route,
      amountOut: quoteResult.amountOut,
      amountOutCurrency,
      sqrtPriceX96After: quoteResult.sqrtPriceX96AfterList[quoteResult.sqrtPriceX96AfterList.length - 1],
      initializedTicksCrossed: quoteResult.initializedTicksCrossedList.reduce((a, b) => a + b, 0),
      gasEstimate: quoteResult.gasEstimate,
    }
  } catch (error) {
    // Route validation failed
    return null
  }
}



