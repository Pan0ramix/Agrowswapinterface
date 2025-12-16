/**
 * V3 Swap Transaction Builder
 *
 * Builds swap transaction payloads (calldata) for SwapRouter contract calls.
 * This replaces Trading API swap endpoints for building transaction calldata.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { getSwapRouterAddress } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'

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
 * Parameters for building exact input single swap transaction
 */
export interface BuildExactInputSingleSwapParams {
  tokenIn: Currency
  tokenOut: Currency
  fee: FeeAmount
  amountIn: CurrencyAmount<Currency>
  amountOutMinimum: CurrencyAmount<Currency> // After slippage
  recipient: string
  deadline: number // Unix timestamp in seconds
  sqrtPriceLimitX96?: string // Optional price limit (0 = no limit)
  chainId: EVMUniverseChainId
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
 * SwapRouter ABI for exactInputSingle
 * Based on SwapRouter02 from @uniswap/swap-router-contracts
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
]

/**
 * Builds exact input single swap transaction payload
 *
 * @param params - Swap parameters
 * @returns Transaction payload with to, data, and value
 */
export function buildExactInputSingleSwapTx(params: BuildExactInputSingleSwapParams): SwapTransactionPayload {
  const { tokenIn, tokenOut, fee, amountIn, amountOutMinimum, recipient, deadline, sqrtPriceLimitX96, chainId } = params

  const routerAddress = getSwapRouterContractAddress(chainId)
  const routerInterface = new Interface(SWAP_ROUTER_ABI)

  const tokenInAddress = tokenIn.wrapped.address
  const tokenOutAddress = tokenOut.wrapped.address
  const amountInRaw = amountIn.quotient.toString()
  const amountOutMinimumRaw = amountOutMinimum.quotient.toString()
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Encode function call
  const data = routerInterface.encodeFunctionData('exactInputSingle', [
    {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee,
      recipient,
      deadline,
      amountIn: amountInRaw,
      amountOutMinimum: amountOutMinimumRaw,
      sqrtPriceLimitX96: priceLimit,
    },
  ])

  // Determine value (native token amount if tokenIn is native)
  const value = tokenIn.isNative ? amountIn.quotient.toString() : '0'

  return {
    to: routerAddress,
    data,
    value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
  }
}

/**
 * Calculate minimum amount out with slippage tolerance
 * Uses SDK's Percent.complement() helper to avoid JSBI directly
 */
export function calculateAmountOutMinimum(
  amountOut: CurrencyAmount<Currency>,
  slippageTolerance: Percent,
): CurrencyAmount<Currency> {
  // complement() = (1 - slippage), which is exactly what we need
  return amountOut.multiply(slippageTolerance.complement())
}

/**
 * Get deadline timestamp (current time + minutes)
 */
export function getDeadline(minutesFromNow: number = 20): number {
  return Math.floor(Date.now() / 1000) + minutesFromNow * 60
}
