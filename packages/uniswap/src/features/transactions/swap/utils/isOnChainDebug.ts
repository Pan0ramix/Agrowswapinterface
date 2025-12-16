/**
 * Debug gate utility for on-chain-only swap debugging
 *
 * Returns true only when:
 * - chainId is in allowlist (at least 84532)
 * - NEXT_PUBLIC_ONCHAIN_DEBUG === '1' (or 'true')
 *
 * Use this to gate all debug logging for on-chain-only swaps.
 */

const ONCHAIN_DEBUG_ALLOWLIST = [84532] as const

export function isOnChainDebug(chainId: number | undefined): boolean {
  if (!chainId || !ONCHAIN_DEBUG_ALLOWLIST.includes(chainId as any)) {
    return false
  }

  const debugEnv = process.env.NEXT_PUBLIC_ONCHAIN_DEBUG || process.env.ONCHAIN_DEBUG
  return debugEnv === '1' || debugEnv === 'true'
}

/**
 * Generate a correlation ID for tracing a single quote/tx-build cycle
 * Format: prefix-timestamp-random
 */
export function makeOnChainDebugId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Debug logger that emits structured JSON payloads
 * Only logs when isOnChainDebug(chainId) returns true
 */
export function debugOnChain(chainId: number | undefined, payload: Record<string, unknown>): void {
  if (!isOnChainDebug(chainId)) {
    return
  }

  console.debug(JSON.stringify(payload, null, 2))
}

/**
 * Math audit logger - emits a single structured JSON bundle with correlation ID
 * Tagged as [ONCHAIN-MATH-AUDIT] for easy filtering
 */
export function debugOnChainMathAudit(
  chainId: number | undefined,
  auditId: string,
  payload: Record<string, unknown>,
): void {
  if (!isOnChainDebug(chainId)) {
    return
  }

  const auditBundle = {
    tag: '[ONCHAIN-MATH-AUDIT]',
    id: auditId,
    ...payload,
  }

  // Convert BigInt values to strings for JSON serialization
  const sanitized = JSON.parse(
    JSON.stringify(auditBundle, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
  )

  console.debug(JSON.stringify(sanitized, null, 2))
}
