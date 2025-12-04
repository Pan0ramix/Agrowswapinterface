import { isNonTestDev } from 'utilities/src/environment/constants'
import { logger } from 'utilities/src/logger/logger'
// biome-ignore lint/style/noRestrictedImports: Platform-specific implementation needs internal types
import { UserPropertyValue } from 'utilities/src/telemetry/analytics/analytics'

interface ErrorLoggers {
  init(err: unknown): void
  setAllowAnalytics(allow: boolean): void
  sendEvent(eventName: string, eventProperties?: Record<string, unknown>): void
  flushEvents(): void
  setUserProperty(property: string, value: UserPropertyValue): void
}

// Dev-only: log notifications once per id+timestamp to avoid spam in polling loops.
// Tracks logged notification events to prevent duplicate logs from polling systems.
const loggedNotificationEvents = new Set<string>()

function shouldLogNotificationEvent(eventName: string, eventProperties?: Record<string, unknown>): boolean {
  // Only deduplicate notification events, not all events
  if (eventName !== 'Notification Received') {
    return true
  }

  // Skip logging in production
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  // Create a unique key from notification id and timestamp to deduplicate
  const notificationId = eventProperties?.notification_id as string | undefined
  const timestamp = eventProperties?.timestamp as number | undefined
  const source = eventProperties?.source as string | undefined

  // For local static banners (like solana_promo_banner), log only once per session
  // since they're polled repeatedly but don't change
  if (source === 'legacy_banners' && notificationId?.startsWith('local:')) {
    const key = `${notificationId}:${source}`
    if (loggedNotificationEvents.has(key)) {
      return false
    }
    loggedNotificationEvents.add(key)
    return true
  }

  // For other notifications, use id + timestamp to deduplicate
  if (notificationId && timestamp !== undefined) {
    const key = `${notificationId}:${timestamp}`
    if (loggedNotificationEvents.has(key)) {
      return false
    }
    loggedNotificationEvents.add(key)
    return true
  }

  // Fallback: log if we can't create a unique key (shouldn't happen normally)
  return true
}

export function generateAnalyticsLoggers(fileName: string): ErrorLoggers {
  return {
    init(error: unknown): void {
      logger.error(error, { tags: { file: fileName, function: 'init' } })
    },
    sendEvent(eventName: string, eventProperties?: Record<string, unknown>): void {
      // Dev-only: log events only when helpful, with deduplication for notifications
      if (isNonTestDev && shouldLogNotificationEvent(eventName, eventProperties)) {
        logger.info('analytics', 'sendEvent', `[Event: ${eventName}]`, eventProperties ?? {})
      }
    },
    setAllowAnalytics(allow: boolean): void {
      if (isNonTestDev) {
        logger.info('analytics', 'setAnonymous', `user allows analytics: ${allow}`)
      }
    },
    flushEvents(): void {
      if (isNonTestDev) {
        logger.info('analytics', 'flushEvents', 'flushing analytics events')
      }
    },
    setUserProperty(property: string, value: UserPropertyValue): void {
      if (isNonTestDev) {
        logger.info('analytics', 'setUserProperty', `[Property: ${property}]: ${value}`)
      }
    },
  }
}
