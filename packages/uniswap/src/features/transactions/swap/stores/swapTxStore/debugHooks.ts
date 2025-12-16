import { boundaryLogDeduped } from 'uniswap/src/utils/boundaryLog'

export function debugMark(label: string) {
  // Using a function call before hooks run in a file is safe; it does not call hooks.
  // Use deduped logging for hook traces
  if (process.env.NODE_ENV !== 'production') {
    boundaryLogDeduped(
      `[HOOK TRACE] ${label}`,
      {},
      84532, // Base Sepolia only
      {
        ttlMs: 20000,
        minIntervalMs: 5000,
        keyParts: [label],
      },
    )
  }
}

/**
 * Deduplicated hook trace logger with explicit chainId support.
 */
export function debugHookTraceDeduped(label: string, payload?: Record<string, unknown>, chainId?: number): void {
  if (process.env.NODE_ENV !== 'production') {
    const effectiveChainId = chainId ?? 84532 // Default to Base Sepolia
    boundaryLogDeduped(`[HOOK TRACE] ${label}`, { extra: payload }, effectiveChainId, {
      ttlMs: 20000,
      minIntervalMs: 5000,
      keyParts: [label, effectiveChainId],
    })
  }
}
