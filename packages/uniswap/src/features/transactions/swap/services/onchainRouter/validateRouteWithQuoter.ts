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
import { getQuoterV2Address } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_QUOTER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { QUOTER_ADDRESSES } from '@uniswap/sdk-core'

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
): Promise<{
  amountOut: string
  sqrtPriceX96After: string
  initializedTicksCrossed: number
  gasEstimate: string
} | null> {
  try {
    const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
    const quoterInterface = new Interface(QUOTER_V2_ABI)

    const callData = quoterInterface.encodeFunctionData('quoteExactInputSingle', [
      {
        tokenIn: hop.tokenIn.address as `0x${string}`,
        tokenOut: hop.tokenOut.address as `0x${string}`,
        amountIn: amountIn.quotient.toString(),
        fee: hop.fee,
        sqrtPriceLimitX96: '0',
      },
    ]) as `0x${string}`

    const result = await publicClient.call({
      to: quoterAddress,
      data: callData,
    })

    if (!result.data) {
      return null
    }

    const decoded = quoterInterface.decodeFunctionResult('quoteExactInputSingle', result.data)

    return {
      amountOut: decoded.amountOut.toString(),
      sqrtPriceX96After: decoded.sqrtPriceX96After.toString(),
      initializedTicksCrossed: Number(decoded.initializedTicksCrossed),
      gasEstimate: decoded.gasEstimate.toString(),
    }
  } catch (error) {
    // Route doesn't exist or has insufficient liquidity
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
): Promise<{
  amountOut: string
  sqrtPriceX96AfterList: string[]
  initializedTicksCrossedList: number[]
  gasEstimate: string
} | null> {
  try {
    const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
    const quoterInterface = new Interface(QUOTER_V2_ABI)

    const path = encodePath(route.hops)

    const callData = quoterInterface.encodeFunctionData('quoteExactInput', [
      path,
      amountIn.quotient.toString(),
    ]) as `0x${string}`

    const result = await publicClient.call({
      to: quoterAddress,
      data: callData,
    })

    if (!result.data) {
      return null
    }

    const decoded = quoterInterface.decodeFunctionResult('quoteExactInput', result.data)

    return {
      amountOut: decoded.amountOut.toString(),
      sqrtPriceX96AfterList: decoded.sqrtPriceX96AfterList.map((p: bigint) => p.toString()),
      initializedTicksCrossedList: decoded.initializedTicksCrossedList.map((t: bigint) => Number(t)),
      gasEstimate: decoded.gasEstimate.toString(),
    }
  } catch (error) {
    // Route doesn't exist or has insufficient liquidity
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
): Promise<ValidatedRoute | null> {
  try {
    // Single hop route
    if (route.hops.length === 1) {
      const quoteResult = await quoteSingleHop(route.hops[0], amountIn, chainId, publicClient)
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
    const quoteResult = await quoteMultiHop(route, amountIn, chainId, publicClient)
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



