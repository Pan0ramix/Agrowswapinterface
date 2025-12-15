/**
 * Quoter Revert Reason Decoder
 * 
 * Decodes revert reasons from Quoter contract calls with comprehensive diagnostics.
 * Supports Error(string), Panic(uint256), and custom errors.
 */

import { decodeErrorResult, Abi } from 'viem'
import { logger } from 'utilities/src/logger/logger'

/**
 * Panic code mappings (from Solidity docs)
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
 * Common V3 Pool and Quoter error ABIs
 */
const V3_ERROR_ABI = [
  {
    type: 'error',
    name: 'Error',
    inputs: [{ name: 'message', type: 'string' }],
  },
  {
    type: 'error',
    name: 'L', // Locked
    inputs: [],
  },
  {
    type: 'error',
    name: 'LOK', // Locked
    inputs: [],
  },
  {
    type: 'error',
    name: 'TF', // Transfer failed
    inputs: [],
  },
  {
    type: 'error',
    name: 'SPL', // Sqrt price limit
    inputs: [],
  },
  {
    type: 'error',
    name: 'STF', // Safe transfer from failed
    inputs: [],
  },
  {
    type: 'error',
    name: 'IIA', // Invalid input amount
    inputs: [],
  },
  {
    type: 'error',
    name: 'IIO', // Invalid output amount
    inputs: [],
  },
] as const

/**
 * ERC20 restriction errors
 */
const RESTRICTION_ERROR_ABI = [
  {
    type: 'error',
    name: 'UserNotAllowed',
    inputs: [{ name: 'user', type: 'address' }],
  },
  {
    type: 'error',
    name: 'TransferRestricted',
    inputs: [],
  },
] as const

/**
 * Decode revert data from error
 * 
 * @param revertData - Hex string of revert data (0x...)
 * @returns Decoded revert reason with details
 */
export function decodeRevertData(revertData: string): {
  decoded: string
  selector: string
  isPanic: boolean
  isErrorString: boolean
  rawData: string
} {
  if (!revertData || !revertData.startsWith('0x')) {
    return {
      decoded: 'Invalid revert data',
      selector: '0x',
      isPanic: false,
      isErrorString: false,
      rawData: revertData,
    }
  }

  const selector = revertData.slice(0, 10) as `0x${string}`
  const data = revertData.slice(10)

  // Check for Panic(uint256) - selector 0x4e487b71
  if (selector === '0x4e487b71') {
    try {
      const panicCode = BigInt(`0x${data.slice(0, 64).padEnd(64, '0')}`)
      const panicMessage = PANIC_CODES[panicCode] || `Unknown panic code ${panicCode.toString(16)}`
      return {
        decoded: `Panic(${panicCode.toString(16)}): ${panicMessage}`,
        selector,
        isPanic: true,
        isErrorString: false,
        rawData: revertData,
      }
    } catch {
      return {
        decoded: `Panic: ${revertData.slice(0, 20)}...`,
        selector,
        isPanic: true,
        isErrorString: false,
        rawData: revertData,
      }
    }
  }

  // Check for Error(string) - selector 0x08c379a0
  if (selector === '0x08c379a0') {
    try {
      // Error(string) encoding: offset (32 bytes) + length (32 bytes) + string data
      const offset = parseInt(data.slice(0, 64), 16)
      const length = parseInt(data.slice(offset * 2, offset * 2 + 64), 16)
      const stringData = data.slice(offset * 2 + 64, offset * 2 + 64 + length * 2)
      const message = Buffer.from(stringData, 'hex').toString('utf-8').replace(/\0/g, '')
      return {
        decoded: `Error: ${message}`,
        selector,
        isPanic: false,
        isErrorString: true,
        rawData: revertData,
      }
    } catch {
      return {
        decoded: `Error(string): ${revertData.slice(0, 50)}...`,
        selector,
        isPanic: false,
        isErrorString: true,
        rawData: revertData,
      }
    }
  }

  // Try to decode as custom error
  const allErrorAbis = [...V3_ERROR_ABI, ...RESTRICTION_ERROR_ABI] as Abi
  for (const abi of allErrorAbis) {
    try {
      const decoded = decodeErrorResult({
        abi: [abi] as Abi,
        data: revertData as `0x${string}`,
      })
      return {
        decoded: formatDecodedError(decoded),
        selector,
        isPanic: false,
        isErrorString: false,
        rawData: revertData,
      }
    } catch {
      continue
    }
  }

  // Unknown error - return selector and raw data
  return {
    decoded: `Unknown error (selector: ${selector})`,
    selector,
    isPanic: false,
    isErrorString: false,
    rawData: revertData,
  }
}

/**
 * Format decoded error for display
 */
function formatDecodedError(decoded: { errorName: string; args?: any }): string {
  const { errorName, args } = decoded

  switch (errorName) {
    case 'L':
    case 'LOK':
      return 'V3 Pool: Locked (reentrancy protection)'
    case 'TF':
      return 'V3 Pool: Transfer failed (token transfer reverted)'
    case 'SPL':
      return 'V3 Pool: Sqrt price limit exceeded'
    case 'STF':
      return 'V3 Pool: Safe transfer from failed (likely token restriction or insufficient balance/allowance)'
    case 'IIA':
      return 'V3 Pool: Invalid input amount'
    case 'IIO':
      return 'V3 Pool: Invalid output amount'
    case 'UserNotAllowed':
      return `Token Restriction: User ${args?.user} is not allowed`
    case 'TransferRestricted':
      return 'Token Restriction: Transfer is restricted for this token'
    default:
      return `Error: ${errorName}${args ? ` (${JSON.stringify(args)})` : ''}`
  }
}

/**
 * Extract revert data from viem/ethers error
 * Handles viem readContract errors which may have different structure than call() errors
 */
export function extractRevertData(error: unknown): string | null {
  if (!error) return null

  // Try various error formats
  const errorObj = error as any
  
  // viem readContract format - data might be in error.data directly
  if (errorObj.data) {
    if (typeof errorObj.data === 'string' && errorObj.data.startsWith('0x')) {
      return errorObj.data
    }
    // Sometimes data is an object with a data property
    if (errorObj.data?.data && typeof errorObj.data.data === 'string' && errorObj.data.data.startsWith('0x')) {
      return errorObj.data.data
    }
  }

  // viem cause format (nested)
  if (errorObj.cause) {
    if (errorObj.cause.data) {
      if (typeof errorObj.cause.data === 'string' && errorObj.cause.data.startsWith('0x')) {
        return errorObj.cause.data
      }
    }
    // Check cause.cause (double nested)
    if (errorObj.cause.cause?.data) {
      if (typeof errorObj.cause.cause.data === 'string' && errorObj.cause.cause.data.startsWith('0x')) {
        return errorObj.cause.cause.data
      }
    }
  }

  // viem shortMessage format (sometimes contains revert data)
  if (errorObj.shortMessage) {
    const match = errorObj.shortMessage.match(/0x[a-fA-F0-9]{8,}/)
    if (match) {
      return match[0]
    }
  }

  // Try to extract from error message
  if (errorObj.message) {
    const match = String(errorObj.message).match(/0x[a-fA-F0-9]{8,}/)
    if (match) {
      return match[0]
    }
  }

  // Try to stringify the entire error and search for hex data
  try {
    const errorString = JSON.stringify(errorObj)
    const match = errorString.match(/0x[a-fA-F0-9]{8,}/)
    if (match) {
      return match[0]
    }
  } catch {
    // Ignore JSON stringify errors
  }

  return null
}

/**
 * Comprehensive revert reason decoder
 * Extracts and decodes revert reasons from quoter errors
 */
export function decodeQuoterRevert(
  error: unknown,
  context?: {
    chainId?: number
    quoterAddress?: string
    poolAddress?: string
    tokenIn?: string
    tokenOut?: string
  },
): {
  decoded: string
  selector: string
  isPanic: boolean
  isErrorString: boolean
  rawData: string | null
  context: typeof context
} {
  const revertData = extractRevertData(error)
  
  if (!revertData) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      decoded: `No revert data found: ${errorMessage}`,
      selector: '0x',
      isPanic: false,
      isErrorString: false,
      rawData: null,
      context,
    }
  }

  const decoded = decodeRevertData(revertData)
  
  return {
    ...decoded,
    context,
  }
}

