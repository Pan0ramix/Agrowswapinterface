/**
 * Update deadline in V3 mint transaction calldata
 * 
 * This utility function updates the deadline parameter in an already-encoded
 * NonfungiblePositionManager.mint() calldata. This is necessary because the
 * deadline must be fresh when the transaction is actually submitted, not when
 * the query result is cached.
 * 
 * Following Uniswap's pattern of computing deadlines at transaction submission time.
 * The deadline value MUST be computed using the same helper as swaps (timestampToDeadline
 * from useTransactionDeadline.ts) to ensure identical behavior.
 * 
 * This is pure glue code - it does NOT compute deadlines, read user settings, or
 * introduce any new TTL semantics. It only decodes, updates, and re-encodes calldata.
 */

import { Interface } from 'ethers/lib/utils'

/**
 * NonfungiblePositionManager.mint function ABI
 * Only the mint function is needed for decoding/encoding
 */
const MINT_FUNCTION_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'token0', type: 'address' },
          { internalType: 'address', name: 'token1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickLower', type: 'int24' },
          { internalType: 'int24', name: 'tickUpper', type: 'int24' },
          { internalType: 'uint256', name: 'amount0Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct INonfungiblePositionManager.MintParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
]

const MINT_INTERFACE = new Interface(MINT_FUNCTION_ABI)

/**
 * Updates the deadline in a V3 mint transaction calldata
 * 
 * This function decodes the mint calldata, updates ONLY the deadline parameter,
 * and re-encodes it. The deadline should be computed using Uniswap's shared
 * deadline helper (timestampToDeadline) to ensure consistency with swap behavior.
 * 
 * @param calldata - The encoded mint calldata (0x88316456...)
 * @param newDeadline - The new deadline value (in seconds, as a number)
 *                      Should be computed using timestampToDeadline from useTransactionDeadline.ts
 * @returns Updated calldata with fresh deadline, or original calldata if update fails
 */
export function updateMintDeadline(calldata: string, newDeadline: number | undefined): string {
  // If no deadline provided, return original calldata (no-op)
  if (newDeadline === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[updateMintDeadline] No deadline provided, returning original calldata', {
        calldata: calldata.substring(0, 20) + '...',
      })
    }
    return calldata
  }

  try {
    // Decode the calldata to get the mint parameters
    const decoded = MINT_INTERFACE.decodeFunctionData('mint', calldata as `0x${string}`)
    const params = decoded[0] // The first (and only) parameter is the MintParams struct

    const oldDeadline = Number(params.deadline)

    // Create updated params with new deadline
    const updatedParams = {
      token0: params.token0,
      token1: params.token1,
      fee: params.fee,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      amount0Desired: params.amount0Desired,
      amount1Desired: params.amount1Desired,
      amount0Min: params.amount0Min,
      amount1Min: params.amount1Min,
      recipient: params.recipient,
      deadline: newDeadline, // Updated deadline (computed using Uniswap's shared helper)
    }

    // Re-encode with fresh deadline
    const updatedCalldata = MINT_INTERFACE.encodeFunctionData('mint', [updatedParams])

    // Dev-only: log deadline update
    if (process.env.NODE_ENV !== 'production') {
      console.log('[updateMintDeadline] Updated deadline in mint calldata', {
        oldDeadline,
        newDeadline,
        deadlineDiff: newDeadline - oldDeadline,
        now: Math.floor(Date.now() / 1000),
      })
    }

    return updatedCalldata
  } catch (error) {
    // If decoding fails, return original calldata
    // This should not happen in normal operation, but we want to be safe
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[updateMintDeadline] Failed to update deadline, returning original calldata', {
        error: error instanceof Error ? error.message : String(error),
        calldata: calldata.substring(0, 20) + '...',
      })
    }
    return calldata
  }
}

