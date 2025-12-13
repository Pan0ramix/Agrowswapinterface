/**
 * Debug utilities for swap execution flow (dev-only, Base Sepolia)
 */

import { logger } from 'utilities/src/logger/logger'

/**
 * Check if swap debug logging is enabled via:
 * 1. localStorage.setItem('debug:swap', '1')
 * 2. URL param ?debugSwap=1
 * 3. env var NEXT_PUBLIC_SWAP_DEBUG=1
 * 4. Base Sepolia (chainId === 84532) in dev mode
 */
function isSwapDebugEnabled(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return false
  }

  // Check localStorage
  if (typeof window !== 'undefined' && typeof Storage !== 'undefined') {
    try {
      if (localStorage.getItem('debug:swap') === '1') {
        return true
      }
    } catch {
      // localStorage may be disabled
    }
  }

  // Check URL param
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('debugSwap') === '1') {
      return true
    }
  }

  // Check env var
  if (process.env.NEXT_PUBLIC_SWAP_DEBUG === '1') {
    return true
  }

  return false
}

export function isSwapDebug(chainId?: number): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    (isSwapDebugEnabled() || chainId === 84532)
  )
}

export function shouldLog(chainId?: number): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    (isSwapDebugEnabled() || chainId === 84532 || chainId === undefined)
  )
}

/**
 * Debug logger wrapper for swap execution flow
 * Always includes message string and structured context
 */
export function swapDebug(
  chainId: number | undefined,
  message: string,
  context?: Record<string, any>,
): void {
  if (!shouldLog(chainId)) {
    return
  }

  const debugEnabled = isSwapDebug(chainId)
  const fullContext = {
    debugEnabled,
    chainId,
    ts: Date.now(),
    ...context,
  }

  // Use logger.debug with proper signature: fileName, functionName, message, ...args
  // Pass context as a single object argument
  logger.debug('swapDebug', 'swapDebug', message, fullContext)
}

/**
 * Error logger wrapper for swap execution flow
 * Never throws - pure logging function
 */
export function swapError(
  chainId: number | undefined,
  message: string,
  context?: Record<string, any>,
): void {
  if (!shouldLog(chainId)) {
    return
  }

  try {
    const debugEnabled = isSwapDebug(chainId)
    
    // Extract error from context if present
    const error = context?.error as unknown
    const restContext = { ...context }
    delete restContext.error

    // Normalize error information
    const e = error instanceof Error ? error : undefined
    const normalized = {
      errorName: e?.name ?? (error != null ? typeof error : 'undefined'),
      errorMessage: e?.message ?? (error != null ? String(error) : message),
      stackShort: e?.stack?.split('\n').slice(0, 4).join('\n'),
      cause: (e as any)?.cause != null ? String((e as any).cause) : undefined,
    }

    const fullContext = {
      debugEnabled,
      chainId,
      ts: Date.now(),
      ...restContext,
      ...normalized,
    }

    // Use the actual error if available, otherwise create a synthetic one for logging
    // This never throws - it's only for logger.error which handles it internally
    const logError = e ?? new Error(message)
    logger.error(logError, {
      tags: { file: 'swapDebug', function: 'swapError' },
      extra: fullContext,
    })
  } catch {
    // If swapError itself fails, silently fail (never throw from error logging)
    // eslint-disable-next-line no-console
    console.error('[swapError] Failed to log error', { chainId, message })
  }
}

/**
 * Safely stringify a value, handling BigInt, CurrencyAmount, and truncating long hex strings
 */
export function safeStringify(value: any): string {
  if (value === null || value === undefined) {
    return String(value)
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'string') {
    // Truncate very long hex strings (likely data fields)
    if (value.startsWith('0x') && value.length > 100) {
      return `0x...${value.length} chars`
    }
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  // Handle CurrencyAmount-like objects
  if (value && typeof value === 'object') {
    if (typeof value.toExact === 'function') {
      try {
        return value.toExact()
      } catch {
        // Fall through
      }
    }
    if (typeof value.toSignificant === 'function') {
      try {
        return value.toSignificant()
      } catch {
        // Fall through
      }
    }
    if (value.quotient != null) {
      try {
        return String(value.quotient)
      } catch {
        // Fall through
      }
    }
  }

  // For objects/arrays, try JSON.stringify with BigInt replacer
  try {
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'bigint') {
        return val.toString()
      }
      // Truncate long hex strings in objects
      if (typeof val === 'string' && val.startsWith('0x') && val.length > 100) {
        return `0x...${val.length} chars`
      }
      return val
    })
  } catch {
    return String(value)
  }
}

/**
 * Summarize a transaction request for logging
 */
export function summarizeTxRequest(tx?: {
  to?: string
  data?: string | unknown
  value?: string | bigint | unknown
  chainId?: number
}): {
  to?: string
  dataLen?: number
  value?: string
  chainId?: number
} {
  if (!tx) {
    return {}
  }

  const result: ReturnType<typeof summarizeTxRequest> = {}

  if (tx.to) {
    result.to = tx.to
  }

  if (tx.data) {
    if (typeof tx.data === 'string') {
      result.dataLen = tx.data.length
    } else if (tx.data && typeof tx.data === 'object' && 'length' in tx.data) {
      result.dataLen = (tx.data as any).length
    } else {
      result.dataLen = undefined
    }
  }

  if (tx.value != null) {
    if (typeof tx.value === 'bigint') {
      result.value = `0x${tx.value.toString(16)}`
    } else if (typeof tx.value === 'string') {
      result.value = tx.value
    } else {
      result.value = String(tx.value)
    }
  }

  if (tx.chainId != null) {
    result.chainId = typeof tx.chainId === 'number' ? tx.chainId : undefined
  }

  return result
}

/**
 * Summarize gas fee info for logging
 */
export function summarizeGasFee(gasFee: any): {
  value?: string
  error?: string
  isLoading?: boolean
} {
  if (!gasFee || typeof gasFee !== 'object') {
    return {}
  }

  const result: ReturnType<typeof summarizeGasFee> = {}

  if (gasFee.value != null) {
    if (typeof gasFee.value === 'bigint') {
      result.value = gasFee.value.toString()
    } else if (typeof gasFee.value === 'string') {
      result.value = gasFee.value
    } else {
      result.value = String(gasFee.value)
    }
  }

  if (gasFee.error != null) {
    result.error = gasFee.error instanceof Error ? gasFee.error.message : String(gasFee.error)
  }

  if (typeof gasFee.isLoading === 'boolean') {
    result.isLoading = gasFee.isLoading
  }

  return result
}

/**
 * Summarize trade info for logging (best-effort, never throws)
 */
export function summarizeTrade(trade: any): {
  hasTrade: boolean
  routing?: string
  inputExact?: string
  outputExact?: string
  hasQuote?: boolean
  hasQuoteQuote?: boolean
} {
  if (!trade) {
    return { hasTrade: false }
  }

  const result: ReturnType<typeof summarizeTrade> = {
    hasTrade: true,
  }

  try {
    if (trade.routing != null) {
      result.routing = String(trade.routing)
    }
  } catch {
    // Ignore
  }

  try {
    if (trade.inputAmount) {
      if (typeof trade.inputAmount.toExact === 'function') {
        result.inputExact = trade.inputAmount.toExact()
      } else if (typeof trade.inputAmount.toSignificant === 'function') {
        result.inputExact = trade.inputAmount.toSignificant()
      }
    }
  } catch {
    // Ignore
  }

  try {
    if (trade.outputAmount) {
      if (typeof trade.outputAmount.toExact === 'function') {
        result.outputExact = trade.outputAmount.toExact()
      } else if (typeof trade.outputAmount.toSignificant === 'function') {
        result.outputExact = trade.outputAmount.toSignificant()
      }
    }
  } catch {
    // Ignore
  }

  try {
    result.hasQuote = !!trade.quote
    result.hasQuoteQuote = !!trade.quote?.quote
  } catch {
    // Ignore
  }

  return result
}

