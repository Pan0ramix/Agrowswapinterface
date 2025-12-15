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
import { logger } from 'utilities/src/logger/logger'

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
  minAmountOut?: CurrencyAmount<Currency> // After slippage (for exact input)
  maxAmountIn?: CurrencyAmount<Currency> // Maximum input with slippage (for exact output)
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
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
          { internalType: 'uint256', name: 'amountInMaximum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter02.ExactOutputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactOutputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountIn', type: 'uint256' }],
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
    maxAmountIn,
    chainId,
    recipient,
    deadline,
    sqrtPriceLimitX96,
  } = params

  const routerAddress = getSwapRouterContractAddress(chainId)
  const routerInterface = new Interface(SWAP_ROUTER_ABI)

  const isExactOut = !!maxAmountIn && !minAmountOut
  const amountInRaw = amountIn.quotient.toString()
  const amountOutMinimumRaw = minAmountOut?.quotient.toString() || '0'
  const amountInMaximumRaw = maxAmountIn?.quotient.toString() || '0'
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Always log for Base Sepolia
  if (chainId === 84532) {
    console.log('[BUILD-SWAP-TX] Building swap tx', {
      chainId,
      isExactOut,
      hasMaxAmountIn: !!maxAmountIn,
      hasMinAmountOut: !!minAmountOut,
      maxAmountInRaw: amountInMaximumRaw,
      minAmountOutRaw: amountOutMinimumRaw,
      amountInRaw,
      hopsCount: route.route.hops.length,
    })
  }

  if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const deadlineSeconds = typeof deadline === 'bigint' ? Number(deadline) : deadline
    logger.debug('buildSwapTx', 'buildSwapTx', 'Building swap tx payload', {
      chainId,
      routerAddress,
      hops: (route.route?.hops ?? []).map((h) => ({
        tokenIn: h.tokenIn.symbol,
        tokenOut: h.tokenOut.symbol,
        fee: h.fee,
      })),
      amountInRaw,
      amountOutMinimumRaw,
      amountInMaximumRaw,
      isExactOut,
      recipient,
      deadline: deadlineSeconds,
      nowSeconds,
      deadlineAgeSeconds: deadlineSeconds - nowSeconds,
      priceLimit,
      gasEstimate: route.gasEstimate,
    })
  }

  // Single hop swap
  if (route.route.hops.length === 1) {
    const hop = route.route.hops[0]

    if (isExactOut && maxAmountIn) {
      // Exact output: use exactOutputSingle
      const amountOutRaw = route.amountOutCurrency?.quotient.toString() || '0'
      
      if (chainId === 84532) {
        console.log('[BUILD-SWAP-TX] Building exactOutputSingle', {
          chainId,
          amountOutRaw,
          amountInMaximumRaw,
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
          fee: hop.fee,
        })
      }
      
      const data = routerInterface.encodeFunctionData('exactOutputSingle', [
        {
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
          fee: hop.fee,
          recipient,
          deadline,
          amountOut: amountOutRaw,
          amountInMaximum: amountInMaximumRaw,
          sqrtPriceLimitX96: priceLimit,
        },
      ])
      
      const result = {
        to: routerAddress,
        data,
        value: hop.tokenIn.isNative ? amountInRaw : '0x0',
      }
      
      if (chainId === 84532) {
        console.log('[BUILD-SWAP-TX] exactOutputSingle result', {
          chainId,
          to: result.to,
          dataLen: result.data?.length,
          value: result.value,
        })
      }
      
      return result
    } else {
      // Exact input: use exactInputSingle
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
 * Get deadline timestamp (current time + TTL seconds)
 * Uniswap-like behavior: deadline is computed fresh at tx build time.
 * 
 * @param ttlSeconds - Time-to-live in seconds (default 1200 = 20 minutes)
 * @returns Unix timestamp in seconds (BigInt)
 */
export function getDeadlineSecondsFromNow(ttlSeconds: number = 1200): bigint {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const deadlineSeconds = nowSeconds + ttlSeconds
  return BigInt(deadlineSeconds)
}

/**
 * Get deadline timestamp (current time + minutes)
 * @deprecated Use getDeadlineSecondsFromNow for consistency
 */
export function getDeadline(minutesFromNow: number = 20): number {
  const deadline = getDeadlineSecondsFromNow(minutesFromNow * 60)
  return Number(deadline)
}



