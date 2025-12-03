import { JsonValue } from '@bufbuild/protobuf'
import { GetNotificationsResponse as GetNotificationsResponseMessage } from '@uniswap/client-notification-service/dist/uniswap/notificationservice/v1/api_pb'
import type {
  AckNotificationRequest,
  AckNotificationResponse,
  GetNotificationsRequest,
  GetNotificationsResponse,
  NotificationsApiClient,
  NotificationsClientContext,
} from '@universe/api/src/clients/notifications/types'

/**
 * Factory function to create a NotificationsApiClient
 *
 * Example usage:
 * ```typescript
 * const notificationsClient = createNotificationsApiClient({
 *   fetchClient: myFetchClient,
 *   getApiPathPrefix: () => '/notifications/v1'
 * })
 *
 * const notifications = await notificationsClient.getNotifications()
 * ```
 *
 * @param ctx - Context containing injected dependencies
 * @returns NotificationsApiClient instance
 */
export function createNotificationsApiClient(ctx: NotificationsClientContext): NotificationsApiClient {
  const { fetchClient, getApiPathPrefix = (): string => '' } = ctx

  const getNotifications = async (params?: GetNotificationsRequest): Promise<GetNotificationsResponse> => {
    const pathPrefix = getApiPathPrefix()
    const path = `${pathPrefix}/uniswap.notificationservice.v1.NotificationService/GetNotifications`

    try {
      const response = await fetchClient.post<JsonValue>(path, {
        body: JSON.stringify(params ?? {}),
      })

      try {
        return GetNotificationsResponseMessage.fromJson(response)
      } catch (decodeError) {
        // Handle decode errors (e.g., unknown platformType for unsupported chains)
        const errorMessage =
          decodeError instanceof Error
            ? decodeError.message
            : String(decodeError)
        
        // Check if this is a decode error related to unsupported chains
        // (decode errors with platformType or unknown fields typically indicate unsupported chain)
        const isUnsupportedChainError =
          errorMessage.includes('decode') ||
          errorMessage.includes('platformType') ||
          errorMessage.includes('unknown')
        
        if (isUnsupportedChainError) {
          // Return empty response for unsupported chains instead of throwing
          // This prevents crashes when notifications service encounters unsupported chains
          try {
            return GetNotificationsResponseMessage.fromJson({ notifications: [] })
          } catch {
            // If creating empty response also fails, return a minimal empty response
            // by creating a new instance with default values
            return new GetNotificationsResponseMessage()
          }
        }
        
        // Re-throw other decode errors as they indicate real issues on supported chains
        throw decodeError
      }
    } catch (error) {
      throw new Error(`Failed to fetch notifications: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      })
    }
  }

  const ackNotification = async (request: AckNotificationRequest): Promise<AckNotificationResponse> => {
    const pathPrefix = getApiPathPrefix()
    const path = `${pathPrefix}/uniswap.notificationservice.v1.NotificationService/AckNotifications`

    try {
      const response = await fetchClient.post<AckNotificationResponse>(path, {
        body: JSON.stringify(request),
      })

      return response
    } catch (error) {
      throw new Error(
        `Failed to acknowledge notifications: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      )
    }
  }

  return {
    getNotifications,
    ackNotification,
  }
}
