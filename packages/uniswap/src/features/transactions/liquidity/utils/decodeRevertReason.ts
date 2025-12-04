/**
 * Revert Reason Decoder
 * 
 * Decodes transaction revert reasons for better error messages.
 * Supports ERC20 errors, V3 pool errors, panic codes, and custom errors.
 */

import { PublicClient, decodeErrorResult, decodeFunctionResult, Abi } from 'viem'
import { logger } from 'utilities/src/logger/logger'

/**
 * Common error ABIs for decoding
 */
const ERC20_ERROR_ABI = [
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: [{ name: 'account', type: 'address' }, { name: 'balance', type: 'uint256' }, { name: 'needed', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'InsufficientAllowance',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'allowance', type: 'uint256' }, { name: 'needed', type: 'uint256' }],
  },
] as const

const V3_POOL_ERROR_ABI = [
  {
    type: 'error',
    name: 'L',
    inputs: [],
  },
  {
    type: 'error',
    name: 'LOK',
    inputs: [],
  },
  {
    type: 'error',
    name: 'TF',
    inputs: [],
  },
] as const

const POSITION_MANAGER_ERROR_ABI = [
  {
    type: 'error',
    name: 'InvalidTickRange',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidAmount',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidPool',
    inputs: [],
  },
] as const

/**
 * Panic code mappings
 */
const PANIC_CODES: Record<bigint, string> = {
  0x01n: 'Assertion failed',
  0x11n: 'Arithmetic underflow or overflow',
  0x12n: 'Division or modulo by zero',
  0x21n: 'Enum conversion out of bounds',
  0x22n: 'Incorrectly encoded storage byte array',
  0x31n: 'Pop on empty array',
  0x32n: 'Array index out of bounds',
  0x41n: 'Too much memory allocated',
  0x51n: 'Zero-initialized variable',
}

/**
 * Decode revert reason from transaction data
 * 
 * @param publicClient - Viem public client
 * @param to - Contract address
 * @param data - Transaction data (calldata)
 * @param value - Transaction value
 * @param from - Sender address (optional, for simulation)
 * @returns Human-readable revert reason or null
 */
export async function decodeRevertReason(
  publicClient: PublicClient,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = 0n,
  from?: `0x${string}`,
): Promise<string | null> {
  try {
    // Try to simulate the transaction to get the revert reason
    if (from) {
      try {
        await publicClient.call({
          to,
          data,
          value,
          account: from,
        })
        // If simulation succeeds, no revert
        return null
      } catch (error: any) {
        // Extract revert reason from error
        const revertData = error?.data || error?.cause?.data
        if (revertData && typeof revertData === 'string' && revertData.startsWith('0x')) {
          return await decodeRevertData(publicClient, to, revertData as `0x${string}`)
        }
      }
    }

    // If we can't simulate, try to decode the data directly
    if (data && data.length > 10) {
      // Extract error selector (first 4 bytes)
      const errorSelector = data.slice(0, 10) as `0x${string}`
      return await decodeRevertData(publicClient, to, errorSelector)
    }

    return null
  } catch (error) {
    logger.warn('decodeRevertReason', 'decodeRevertReason', 'Failed to decode revert reason', {
      extra: { error: error instanceof Error ? error.message : String(error) },
    })
    return null
  }
}

/**
 * Decode revert data
 */
async function decodeRevertData(
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
  revertData: `0x${string}`,
): Promise<string | null> {
  // Try panic codes first (0x4e487b71)
  if (revertData.startsWith('0x4e487b71')) {
    try {
      const panicCode = BigInt(`0x${revertData.slice(10)}`)
      const panicMessage = PANIC_CODES[panicCode] || `Panic code ${panicCode.toString(16)}`
      return `Panic: ${panicMessage}`
    } catch {
      // Not a panic code, continue
    }
  }

  // Try common error ABIs
  const allErrorAbis = [...ERC20_ERROR_ABI, ...V3_POOL_ERROR_ABI, ...POSITION_MANAGER_ERROR_ABI] as Abi

  for (const abi of allErrorAbis) {
    try {
      const decoded = decodeErrorResult({
        abi: [abi] as Abi,
        data: revertData,
      })
      return formatDecodedError(decoded)
    } catch {
      // Try next ABI
      continue
    }
  }

  // If we can't decode, return the raw data
  return `Revert: ${revertData.slice(0, 20)}...`
}

/**
 * Format decoded error for display
 */
function formatDecodedError(decoded: { errorName: string; args?: any }): string {
  const { errorName, args } = decoded

  switch (errorName) {
    case 'InsufficientBalance':
      return `Insufficient balance: need ${args?.needed?.toString()}, have ${args?.balance?.toString()}`
    case 'InsufficientAllowance':
      return `Insufficient allowance: need ${args?.needed?.toString()}, have ${args?.allowance?.toString()}`
    case 'L':
      return 'V3 Pool: Locked'
    case 'LOK':
      return 'V3 Pool: Locked'
    case 'TF':
      return 'V3 Pool: Transfer failed'
    case 'InvalidTickRange':
      return 'Invalid tick range: tickLower must be < tickUpper'
    case 'InvalidAmount':
      return 'Invalid amount: amount must be > 0'
    case 'InvalidPool':
      return 'Invalid pool: pool does not exist'
    default:
      return `Error: ${errorName}${args ? ` (${JSON.stringify(args)})` : ''}`
  }
}

/**
 * Simulate transaction and decode revert if it fails
 * 
 * @param publicClient - Viem public client
 * @param params - Transaction parameters
 * @returns Simulation result or decoded revert reason
 */
export async function simulateTransaction(
  publicClient: PublicClient,
  params: {
    to: `0x${string}`
    data: `0x${string}`
    value?: bigint
    account: `0x${string}`
  },
): Promise<{ success: true } | { success: false; reason: string }> {
  try {
    // Use call() to simulate the transaction - this will revert if the transaction would fail
    await publicClient.call({
      to: params.to,
      data: params.data,
      value: params.value || 0n,
      account: params.account,
    })
    // If we get here, simulation succeeded
    return { success: true }
  } catch (error: any) {
    // Transaction would revert - decode the reason
    const revertReason = await decodeRevertReason(
      publicClient,
      params.to,
      params.data,
      params.value || 0n,
      params.account,
    )
    return {
      success: false,
      reason: revertReason || error?.message || error?.shortMessage || 'Transaction would revert',
    }
  }
}

