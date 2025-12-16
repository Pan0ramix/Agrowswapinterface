/**
 * Log deduplication utility to reduce console spam while preserving debugging signal.
 * Implements TTL-based deduplication with repeat aggregation, minInterval guards, and token bucket rate limiting.
 *
 * Recommended TTLs:
 * - HookProbe: ttlMs: 5000-15000, minIntervalMs: 2000-3000
 * - Trade structure: ttlMs: 4000, minIntervalMs: 2000
 * - On-chain quote logs: ttlMs: 3000, minIntervalMs: 1500
 * - Swap button/UI state: ttlMs: 5000, minIntervalMs: 5000
 */

// Gate dedupe maps behind __DEV__ to avoid overhead in production
// Also check REACT_APP_DEDUP_LOGS env var (default on in dev, can be disabled with REACT_APP_DEDUP_LOGS=0)
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'
const isDedupEnabled = isDev && (typeof process === 'undefined' || process.env.REACT_APP_DEDUP_LOGS !== '0')

export interface DedupeOptions {
  ttlMs?: number // default 1500
  maxEntries?: number // default 250
  includeKeys?: string[] // allow selecting stable subset of payload fields for keying
  key?: string // explicit override key
  flushSuppressed?: boolean // default true
  level?: 'info' | 'debug' | 'warn' | 'error'
  bypass?: boolean // if true, skip deduplication entirely
  minIntervalMs?: number // default 0 - do not log more often than this even if payload differs
  maxPerWindow?: number // default 0 = disabled - token bucket per key
  windowMs?: number // default 0 = disabled - token bucket window
  keyParts?: unknown[] // explicit stable key parts (preferred over hashing full payload)
  payloadMode?: 'none' | 'includeKeys' | 'hash' // default 'includeKeys' if includeKeys provided else 'none'
}

interface DedupeEntry {
  lastTs: number
  lastEmittedAt: number // For minInterval tracking
  suppressed: number
  lastPayloadHash?: string
  // Token bucket state
  windowStartTs?: number
  emittedInWindow?: number
}

// In-memory deduplication map
const dedupeMap = new Map<string, DedupeEntry>()

// Track insertion order for LRU eviction
const insertionOrder: string[] = []

// Global burst guard (dev-only, for debug/info only)
const GLOBAL_MAX_LOGS_PER_SEC = 30
let globalLogCount = 0
let globalLogWindowStart = Date.now()
let globalThrottleUntil = 0

/**
 * Stable stringify that sorts keys and drops undefined, functions, and handles circular refs safely.
 * Only includes keys from allowList if provided.
 */
function stableStringify(obj: any, allowList?: string[]): string {
  if (obj === null || obj === undefined) {
    return String(obj)
  }

  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj)
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => stableStringify(item, allowList)).join(',')}]`
  }

  if (typeof obj === 'object') {
    const keys = allowList ? allowList.filter((k) => k in obj) : Object.keys(obj).sort()
    const pairs = keys
      .map((key) => {
        const value = obj[key]
        // Skip undefined, functions, and volatile fields
        if (
          value === undefined ||
          typeof value === 'function' ||
          key === 'renderCount' ||
          key === 'ts' ||
          key === 'timestamp' ||
          key === 'stack'
        ) {
          return null
        }
        return `${key}:${stableStringify(value, allowList)}`
      })
      .filter((pair) => pair !== null)
    return `{${pairs.join(',')}}`
  }

  return String(obj)
}

/**
 * Pick specific keys from an object, creating a new object with only those keys.
 */
function pick(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') return {}
  const result: any = {}
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result
}

/**
 * Build a stable dedupe key from message and payload.
 * Excludes volatile fields like renderCount, ts, timestamp, stack.
 * Supports explicit keyParts for maximum stability.
 */
function buildDedupeKey(message: string, payload: any, chainId?: number, options?: DedupeOptions): string {
  // Explicit key takes precedence
  if (options?.key) {
    return options.key
  }

  // Use keyParts if provided (most stable)
  if (options?.keyParts && options.keyParts.length > 0) {
    const keyPartsStr = stableStringify(options.keyParts)
    return `${message}|${keyPartsStr}`
  }

  // Extract stable fields from payload based on payloadMode
  const payloadMode = options?.payloadMode ?? (options?.includeKeys ? 'includeKeys' : 'none')
  let stablePayload: any = {}

  if (payloadMode === 'includeKeys' && options?.includeKeys) {
    // Pick only specified keys from payload (handle both direct payload and payload.extra)
    const sourcePayload = payload?.extra ?? payload
    stablePayload = pick(sourcePayload, options.includeKeys)
  } else if (payloadMode === 'hash') {
    // Include all stable fields except volatile ones
    const sourcePayload = payload?.extra ?? payload
    if (sourcePayload && typeof sourcePayload === 'object') {
      for (const key in sourcePayload) {
        if (
          key !== 'renderCount' &&
          key !== 'ts' &&
          key !== 'timestamp' &&
          key !== 'stack' &&
          typeof sourcePayload[key] !== 'function'
        ) {
          stablePayload[key] = sourcePayload[key]
        }
      }
    }
  }
  // payloadMode === 'none' means don't include payload in key (most aggressive)

  // Build key from: message + chainId + stable payload
  const parts = [message]
  if (chainId != null) {
    parts.push(String(chainId))
  }

  // Add stable payload stringification only if there are fields and mode allows it
  if (payloadMode !== 'none') {
    const payloadStr = stableStringify(stablePayload, options?.includeKeys)
    if (payloadStr && payloadStr !== '{}' && payloadStr !== '[]') {
      parts.push(payloadStr)
    }
  }

  return parts.join('|')
}

/**
 * Evict oldest entries if map exceeds maxEntries.
 */
function evictOldest(maxEntries: number): void {
  if (dedupeMap.size <= maxEntries) {
    return
  }

  // Find oldest entry by lastTs
  let oldestKey: string | null = null
  let oldestTs = Infinity

  for (const [key, entry] of dedupeMap.entries()) {
    if (entry.lastTs < oldestTs) {
      oldestTs = entry.lastTs
      oldestKey = key
    }
  }

  if (oldestKey) {
    dedupeMap.delete(oldestKey)
    const index = insertionOrder.indexOf(oldestKey)
    if (index >= 0) {
      insertionOrder.splice(index, 1)
    }
  }
}

/**
 * Check global burst guard (dev-only, for debug/info only).
 * Returns true if log should be suppressed due to global throttle.
 */
function checkGlobalBurstGuard(level?: string): boolean {
  if (!isDev || level === 'warn' || level === 'error') {
    return false
  }

  const now = Date.now()
  const elapsed = now - globalLogWindowStart

  // Reset window every second
  if (elapsed >= 1000) {
    if (globalLogCount > GLOBAL_MAX_LOGS_PER_SEC) {
      globalThrottleUntil = now + 1000
    }
    globalLogCount = 0
    globalLogWindowStart = now
  }

  // Check if we're in throttle period
  if (now < globalThrottleUntil) {
    globalLogCount++
    return true
  }

  // Increment counter
  globalLogCount++

  // If we exceeded limit, start throttle
  if (globalLogCount > GLOBAL_MAX_LOGS_PER_SEC) {
    globalThrottleUntil = now + 1000
    // biome-ignore lint/suspicious/noConsole: Dev-only throttling message
    console.warn(
      `[DEDUPED] global throttle engaged (suppressed ${globalLogCount - GLOBAL_MAX_LOGS_PER_SEC} logs in last 1s)`,
    )
    return true
  }

  return false
}

/**
 * Deduplicated log function wrapper.
 * First occurrence logs immediately, subsequent occurrences within TTL are suppressed.
 * When TTL expires, logs a "suppressed N repeats" line if there were repeats.
 * Supports minInterval guards and token bucket rate limiting.
 */
export function dedupeLog(
  logFn: (message: string, payload?: any, chainId?: number) => void,
  message: string,
  payload?: any,
  chainId?: number,
  options?: DedupeOptions,
): void {
  // Bypass deduplication if requested or not enabled
  if (options?.bypass || !isDedupEnabled) {
    logFn(message, payload, chainId)
    return
  }

  // Check global burst guard (dev-only, for debug/info only)
  if (checkGlobalBurstGuard(options?.level)) {
    return
  }

  const ttlMs = options?.ttlMs ?? 1500
  const maxEntries = options?.maxEntries ?? 250
  const flushSuppressed = options?.flushSuppressed !== false
  const minIntervalMs = options?.minIntervalMs ?? 0
  const maxPerWindow = options?.maxPerWindow ?? 0
  const windowMs = options?.windowMs ?? 0

  const key = buildDedupeKey(message, payload, chainId, options)
  const now = Date.now()
  const entry = dedupeMap.get(key)

  if (!entry) {
    // First occurrence: log immediately and store entry
    logFn(message, payload, chainId)
    const newEntry: DedupeEntry = {
      lastTs: now,
      lastEmittedAt: now,
      suppressed: 0,
      lastPayloadHash: stableStringify(payload, options?.includeKeys),
    }
    if (maxPerWindow > 0 && windowMs > 0) {
      newEntry.windowStartTs = now
      newEntry.emittedInWindow = 1
    }
    dedupeMap.set(key, newEntry)
    insertionOrder.push(key)
    evictOldest(maxEntries)
    return
  }

  // Check minInterval gate (suppress if too soon)
  if (minIntervalMs > 0 && now - entry.lastEmittedAt < minIntervalMs) {
    entry.suppressed += 1
    return
  }

  // Check token bucket (if enabled)
  if (maxPerWindow > 0 && windowMs > 0) {
    const windowStart = entry.windowStartTs ?? now
    const elapsed = now - windowStart

    // Reset window if expired
    if (elapsed >= windowMs) {
      entry.windowStartTs = now
      entry.emittedInWindow = 1
    } else {
      // Check if we've exceeded the limit
      const emitted = entry.emittedInWindow ?? 0
      if (emitted >= maxPerWindow) {
        entry.suppressed += 1
        return
      }
      entry.emittedInWindow = emitted + 1
    }
  }

  const age = now - entry.lastTs

  if (age < ttlMs) {
    // Within TTL: increment suppressed count, don't log
    entry.suppressed += 1
    return
  }

  // TTL expired: log suppressed count if any, then log new message
  // Only print summary if suppressed >= 3 (to avoid spam)
  if (entry.suppressed >= 3 && flushSuppressed) {
    const suppressedMessage = `[DEDUPED] suppressed ${entry.suppressed} repeats: ${message}`
    logFn(suppressedMessage, payload, chainId)
  }

  // Log the new message normally
  logFn(message, payload, chainId)

  // Reset entry
  entry.lastTs = now
  entry.lastEmittedAt = now
  entry.suppressed = 0
  entry.lastPayloadHash = stableStringify(payload, options?.includeKeys)
}

/**
 * Create a deduplicated logger with default options.
 */
export function createDedupeLogger({
  logFn,
  defaultTtlMs = 1500,
  maxEntries = 250,
}: {
  logFn: (message: string, payload?: any, chainId?: number) => void
  defaultTtlMs?: number
  maxEntries?: number
}) {
  return (message: string, payload?: any, chainId?: number, options?: DedupeOptions): void => {
    dedupeLog(logFn, message, payload, chainId, {
      ttlMs: defaultTtlMs,
      maxEntries,
      ...options,
    })
  }
}
