/**
 * Swap Transaction Builder
 * 
 * Builds swap transaction payloads with proper path encoding for single and multi-hop swaps.
 * Uses Uniswap's exact path encoding format: address | fee | address | fee | address
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { getSwapRouterAddress } from 'uniswap/src/constants/v3Addresses'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { ValidatedRoute } from './validateRouteWithQuoter'

/**
 * Transaction payload for swap
 */
export interface SwapTransactionPayload {
  to: string
  data: string
  value: string // '0x0' for ERC20 swaps, or amount in wei for native token swaps
  gasLimit?: string
}

/**
 * Parameters for building swap transaction
 */
export interface BuildSwapTxParams {
  route: ValidatedRoute
  amountIn: CurrencyAmount<Currency>
  minAmountOut: CurrencyAmount<Currency> // After slippage
  chainId: EVMUniverseChainId
  recipient: string
  deadline: number // Unix timestamp in seconds
  sqrtPriceLimitX96?: string // Optional price limit (0 = no limit)
}

/**
 * Get SwapRouter contract address
 */
function getSwapRouterContractAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap address first for Base Sepolia
  if (chainId === 84532) {
    return getAgroswapSwapRouterAddress(chainId)
  }

  // Try v3Addresses override
  const v3Address = getSwapRouterAddress(chainId)
  if (v3Address) {
    return v3Address
  }

  throw new Error(`SwapRouter address not found for chain ${chainId}`)
}

/**
 * SwapRouter ABI for exactInputSingle and exactInput
 */
const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter02.ExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'path', type: 'bytes' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
        ],
        internalType: 'struct ISwapRouter02.ExactInputParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInput',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

/**
 * Encode path for multi-hop swap
 * Format: address (20 bytes) | fee (3 bytes) | address (20 bytes) | fee (3 bytes) | address (20 bytes)
 * 
 * Example for 2 hops:
 * token0 (20 bytes) | fee0 (3 bytes) | token1 (20 bytes) | fee1 (3 bytes) | token2 (20 bytes)
 */
function encodePath(hops: ValidatedRoute['route']['hops']): `0x${string}` {
  let path = '0x'
  
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]
    
    // Add tokenIn address (20 bytes = 40 hex chars)
    // Remove '0x' prefix and pad to 40 characters
    const address = hop.tokenIn.address.slice(2).toLowerCase().padStart(40, '0')
    path += address

    // Add fee (3 bytes = 6 hex chars)
    const feeHex = hop.fee.toString(16).padStart(6, '0')
    path += feeHex

    // Add last tokenOut address
    if (i === hops.length - 1) {
      const lastAddress = hop.tokenOut.address.slice(2).toLowerCase().padStart(40, '0')
      path += lastAddress
    }
  }
  
  return path as `0x${string}`
}

/**
 * Build swap transaction payload
 * 
 * @param params - Swap parameters
 * @returns Transaction payload with to, data, and value
 */
export function buildSwapTx(params: BuildSwapTxParams): SwapTransactionPayload {
  const {
    route,
    amountIn,
    minAmountOut,
    chainId,
    recipient,
    deadline,
    sqrtPriceLimitX96,
  } = params

  const routerAddress = getSwapRouterContractAddress(chainId)
  const routerInterface = new Interface(SWAP_ROUTER_ABI)

  const amountInRaw = amountIn.quotient.toString()
  const amountOutMinimumRaw = minAmountOut.quotient.toString()
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Single hop swap
  if (route.route.hops.length === 1) {
    const hop = route.route.hops[0]

    const data = routerInterface.encodeFunctionData('exactInputSingle', [
      {
        tokenIn: hop.tokenIn.address,
        tokenOut: hop.tokenOut.address,
        fee: hop.fee,
        recipient,
        deadline,
        amountIn: amountInRaw,
        amountOutMinimum: amountOutMinimumRaw,
        sqrtPriceLimitX96: priceLimit,
      },
    ])

    // Determine value (native token amount if tokenIn is native)
    const value = amountIn.currency.isNative ? amountIn.quotient.toString() : '0'

    return {
      to: routerAddress,
      data,
      value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
      gasLimit: route.gasEstimate,
    }
  }

  // Multi-hop swap
  const path = encodePath(route.route.hops)

  const data = routerInterface.encodeFunctionData('exactInput', [
    {
      path,
      recipient,
      deadline,
      amountIn: amountInRaw,
      amountOutMinimum: amountOutMinimumRaw,
    },
  ])

  // Determine value (native token amount if first tokenIn is native)
  const firstTokenIn = route.route.hops[0].tokenIn
  const value = amountIn.currency.isNative ? amountIn.quotient.toString() : '0'

  return {
    to: routerAddress,
    data,
    value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
    gasLimit: route.gasEstimate,
  }
}

/**
 * Calculate minimum amount out with slippage tolerance
 */
export function calculateAmountOutMinimum(
  amountOut: CurrencyAmount<Currency>,
  slippageTolerance: Percent | { numerator?: bigint | number; denominator?: bigint | number } | number,
): CurrencyAmount<Currency> {
  // Guard against malformed slippage inputs (e.g. plain numbers or dehydrated objects)
  const percent = slippageTolerance instanceof Percent
    ? slippageTolerance
    : new Percent(
        (slippageTolerance as any)?.numerator ?? Math.round((Number(slippageTolerance) || 0.5) * 100),
        (slippageTolerance as any)?.denominator ?? 10_000,
      )

  // complement() = (1 - slippage); if complement is unavailable, fall back to no slippage
  const complement =
    typeof (percent as any).complement === 'function'
      ? (percent as any).complement()
      : new Percent(1, 1)

  return amountOut.multiply(complement)
}

/**
 * Get deadline timestamp (current time + minutes)
 */
export function getDeadline(minutesFromNow: number = 20): number {
  return Math.floor(Date.now() / 1000) + minutesFromNow * 60
}



