import { logger } from 'utilities/src/logger/logger'
import { dedupeLog, type DedupeOptions } from 'utilities/src/logger/dedupeLog'

type BoundaryPayload = {
  tags?: Record<string, unknown>
  extra?: Record<string, unknown>
}

// Check if deduplication is enabled (default on in dev)
const isDedupEnabled =
  typeof process !== 'undefined' && process.env.REACT_APP_DEDUP_LOGS !== '0'

/**
 * Instrumentation logging helper for Base Sepolia (84532) swap flow debugging.
 * Uses logger.info to avoid triggering console.error stack spam from silenceReactDevNoise.ts
 * Immediate logging - use for critical events that must appear every time.
 */
export function boundaryLog(
  message: string,
  payload: BoundaryPayload = {},
  chainId?: number
): void {
  if (chainId !== 84532) return
  // Use logger.info to avoid dev console stack spam (logger.error triggers "Understand this error")
  // logger.info signature: (fileName, functionName, message, ...args)
  const fileName = (payload.tags?.file as string) ?? 'boundaryLog'
  const functionName = (payload.tags?.function as string) ?? 'boundaryLog'
  const extra = payload.extra ?? {}
  // TEMPORARY: Smoke log to prove boundaryLog is being called
  logger.info(fileName, functionName, `[BOUNDARYLOG-SMOKE] ${message}`, extra)
}

/**
 * Deduplicated boundary log - use for spammy/repeating logs.
 * First occurrence logs immediately, subsequent occurrences within TTL are suppressed.
 * When TTL expires, logs a "suppressed N repeats" line if there were repeats.
 */
export function boundaryLogDeduped(
  message: string,
  payload: BoundaryPayload = {},
  chainId?: number,
  options?: DedupeOptions
): void {
  if (chainId !== 84532) return

  // If dedup is disabled, fall back to immediate logging
  if (!isDedupEnabled) {
    boundaryLog(message, payload, chainId)
    return
  }

  // Wrap boundaryLog with deduplication
  dedupeLog(
    (msg, pld, cid) => {
      const fileName = (pld?.tags?.file as string) ?? 'boundaryLog'
      const functionName = (pld?.tags?.function as string) ?? 'boundaryLog'
      const extra = pld?.extra ?? {}
      logger.info(fileName, functionName, `[BOUNDARYLOG-SMOKE] ${msg}`, extra)
    },
    message,
    payload,
    chainId,
    {
      ttlMs: 5000, // default TTL (5 seconds)
      minIntervalMs: 5000, // default min interval (5 seconds)
      maxPerWindow: 3, // default max per window
      windowMs: 2000, // default window
      maxEntries: 250, // default max entries
      ...options,
    }
  )
}

