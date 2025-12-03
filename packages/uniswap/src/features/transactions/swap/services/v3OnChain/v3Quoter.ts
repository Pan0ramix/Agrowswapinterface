/**
 * V3 Quoter Service
 * 
 * Gets quotes for V3 swaps using the Quoter or QuoterV2 contract on-chain.
 * This replaces Trading API quote endpoints.
 */

import { Currency, CurrencyAmount, Token } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { PublicClient } from 'viem'
import { EVMUniverseChainId, UniverseChainId } from 'uniswap/src/features/chains/types'
import { getQuoterV2Address } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_QUOTER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { QUOTER_ADDRESSES } from '@uniswap/sdk-core'

/**
 * Quote result from Quoter contract
 */
export interface V3QuoteResult {
  amountOut: string
  sqrtPriceX96After?: string
  initializedTicksCrossed?: number
  gasEstimate?: string
}

/**
 * Parameters for exact input single quote
 */
export interface QuoteExactInputSingleParams {
  tokenIn: Currency
  tokenOut: Currency
  fee: FeeAmount
  amountIn: CurrencyAmount<Currency>
  sqrtPriceLimitX96?: string // Optional price limit
  chainId: EVMUniverseChainId
  publicClient: PublicClient
}

/**
 * Get Quoter contract address for the given chain
 */
function getQuoterAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap addresses first for Base Sepolia
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
 * QuoterV2 ABI - supports quoteExactInputSingle with gas estimation
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
]

/**
 * Legacy Quoter ABI - fallback for chains without QuoterV2
 */
const QUOTER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenIn', type: 'address' },
      { internalType: 'address', name: 'tokenOut', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    name: 'quoteExactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

/**
 * Quotes exact input single swap using QuoterV2 contract
 * 
 * @param params - Quote parameters
 * @returns Quote result with amountOut and optional gas estimate
 */
export async function quoteExactInputSingle(
  params: QuoteExactInputSingleParams,
): Promise<V3QuoteResult> {
  const { tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96, chainId, publicClient } = params

  const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
  const tokenInAddress = tokenIn.wrapped.address as `0x${string}`
  const tokenOutAddress = tokenOut.wrapped.address as `0x${string}`
  const amountInRaw = amountIn.quotient.toString()
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Try QuoterV2 first (has gas estimate)
  const quoterV2Interface = new Interface(QUOTER_V2_ABI)

  try {
    const callData = quoterV2Interface.encodeFunctionData('quoteExactInputSingle', [
      {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInRaw,
        fee: fee,
        sqrtPriceLimitX96: priceLimit,
      },
    ]) as `0x${string}`

    const result = await publicClient.call({
      to: quoterAddress,
      data: callData,
    })

    if (!result.data) {
      throw new Error('Quoter call returned no data')
    }

    const decoded = quoterV2Interface.decodeFunctionResult('quoteExactInputSingle', result.data)

    return {
      amountOut: decoded.amountOut.toString(),
      sqrtPriceX96After: decoded.sqrtPriceX96After.toString(),
      initializedTicksCrossed: Number(decoded.initializedTicksCrossed),
      gasEstimate: decoded.gasEstimate.toString(),
    }
  } catch (error) {
    // If QuoterV2 fails, try legacy Quoter
    const quoterInterface = new Interface(QUOTER_ABI)

    try {
      const callData = quoterInterface.encodeFunctionData('quoteExactInputSingle', [
        tokenInAddress,
        tokenOutAddress,
        fee,
        amountInRaw,
        priceLimit,
      ]) as `0x${string}`

      const result = await publicClient.call({
        to: quoterAddress,
        data: callData,
      })

      if (!result.data) {
        throw new Error('Quoter call returned no data')
      }

      const decoded = quoterInterface.decodeFunctionResult('quoteExactInputSingle', result.data)

      return {
        amountOut: decoded.amountOut.toString(),
      }
    } catch (legacyError) {
      // Re-throw with more context
      const errorMessage = error instanceof Error ? error.message : String(error)
      const legacyErrorMessage = legacyError instanceof Error ? legacyError.message : String(legacyError)
      
      throw new Error(
        `Quoter call failed (V2: ${errorMessage}, Legacy: ${legacyErrorMessage}). Pool may not exist or have insufficient liquidity.`,
      )
    }
  }
}

/**
 * User-friendly error messages for common quote failures
 */
export function parseQuoteError(error: unknown): string {
  const errorString = error instanceof Error ? error.message : String(error)

  if (errorString.includes('STF') || errorString.includes('insufficient liquidity')) {
    return 'Insufficient liquidity in pool for this swap'
  }

  if (errorString.includes('SPL') || errorString.includes('price limit')) {
    return 'Price limit exceeded'
  }

  if (errorString.includes('revert') || errorString.includes('execution reverted')) {
    return 'Pool does not exist or swap cannot be executed'
  }

  return errorString || 'Failed to get quote from pool'
}

