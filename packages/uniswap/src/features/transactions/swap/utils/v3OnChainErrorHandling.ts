/**
 * V3 On-Chain Error Handling
 * 
 * Utilities for converting on-chain errors into user-friendly messages.
 */

/**
 * Converts on-chain error messages to user-friendly strings
 */
export function formatV3OnChainError(error: unknown): string {
  const errorString = error instanceof Error ? error.message : String(error)

  // Pool-related errors
  if (errorString.includes('Pool does not exist') || errorString.includes('pool does not exist')) {
    return 'This trading pair is not available. The pool may not exist yet.'
  }

  if (errorString.includes('Insufficient liquidity') || errorString.includes('insufficient liquidity')) {
    return 'Not enough liquidity in the pool for this swap. Try a smaller amount.'
  }

  if (errorString.includes('STF') || errorString.includes('insufficient output amount')) {
    return 'Insufficient liquidity for this swap amount'
  }

  // Price limit errors
  if (errorString.includes('SPL') || errorString.includes('price limit')) {
    return 'Price moved beyond acceptable range. Please try again.'
  }

  // Quote errors
  if (errorString.includes('Quoter call failed') || errorString.includes('quote')) {
    return 'Unable to get a quote. The pool may not have enough liquidity.'
  }

  // Transaction building errors
  if (errorString.includes('Transaction') || errorString.includes('calldata')) {
    return 'Failed to build transaction. Please try again.'
  }

  // Network errors
  if (errorString.includes('network') || errorString.includes('timeout') || errorString.includes('fetch')) {
    return 'Network error. Please check your connection and try again.'
  }

  // Generic revert
  if (errorString.includes('revert') || errorString.includes('execution reverted')) {
    return 'Transaction would fail. Please check your inputs and try again.'
  }

  // Return original error if we can't categorize it
  return errorString || 'An unexpected error occurred. Please try again.'
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  const errorString = error instanceof Error ? error.message : String(error)

  // Network errors are retryable
  if (errorString.includes('network') || errorString.includes('timeout') || errorString.includes('fetch')) {
    return true
  }

  // Rate limiting is retryable
  if (errorString.includes('rate limit') || errorString.includes('too many requests')) {
    return true
  }

  // Pool/quote errors are not retryable (they indicate a real problem)
  if (
    errorString.includes('Pool does not exist') ||
    errorString.includes('Insufficient liquidity') ||
    errorString.includes('price limit')
  ) {
    return false
  }

  // Default to not retryable for safety
  return false
}




