/**
 * @file Admin API routes for managing custom notifications
 * @description Provides endpoints for retrieving custom notifications in the JYT Commerce platform
 * @module API/Admin/Notifications
 */

/**
 * @typedef {Object} AdminNotificationsQueryParams
 * @property {number} [limit=20] - Number of notifications to return (default: 20)
 * @property {number} [offset=0] - Pagination offset (default: 0)
 * @property {string} [q] - Search query for filtering notifications
 * @property {string} [channel] - Filter by notification channel
 * @property {string} [status] - Filter by notification status
 * @property {string} [fields] - Comma-separated list of fields to include in response
 * @property {string} [id] - Filter by specific notification ID
 */

/**
 * @typedef {Object} Notification
 * @property {string} id - The unique identifier of the notification
 * @property {string} to - Recipient of the notification
 * @property {string} channel - Channel through which notification was sent
 * @property {string} template - Template used for the notification
 * @property {string} external_id - External reference ID
 * @property {string} provider_id - Provider ID for the notification service
 * @property {Date} created_at - When the notification was created
 * @property {string} status - Current status of the notification
 * @property {Object} data - Additional notification data
 */

/**
 * @typedef {Object} NotificationsListResponse
 * @property {Notification[]} notifications - Array of notification objects
 * @property {number} count - Total count of notifications matching filters
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Number of items returned per page
 */

/**
 * List custom notifications with pagination and filtering
 * @route GET /admin/notifications/custom
 * @group Notifications - Operations related to notifications
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of items to return
 * @param {string} [q] - Search query for filtering notifications
 * @param {string} [channel] - Filter by notification channel
 * @param {string} [status] - Filter by notification status
 * @param {string} [fields] - Comma-separated list of fields to include in response
 * @param {string} [id] - Filter by specific notification ID
 * @returns {NotificationsListResponse} 200 - Paginated list of custom notifications
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/notifications/custom?limit=10&offset=0&channel=email&status=sent
 *
 * @example response 200
 * {
 *   "notifications": [
 *     {
 *       "id": "notif_123456789",
 *       "to": "customer@example.com",
 *       "channel": "email",
 *       "template": "order_confirmation",
 *       "external_id": "ext_987654321",
 *       "provider_id": "mailgun",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "status": "sent",
 *       "data": {
 *         "order_id": "order_123",
 *         "amount": 99.99
 *       }
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"

import type { AdminNotificationsQueryParams } from "../validators"

export const GET = async (
  req: MedusaRequest<AdminNotificationsQueryParams>,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY
  ) as Omit<RemoteQueryFunction, symbol>

  const {
    limit = 20,
    offset = 0,
    q,
    channel,
    status,
    fields,
    id,
  } = (req.validatedQuery || {}) as Partial<AdminNotificationsQueryParams>

  const selectedFields =
    typeof fields === "string" && fields.trim().length
      ? fields
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
      : [
          "id",
          "to",
          "channel",
          "template",
          "external_id",
          "provider_id",
          "created_at",
          "status",
          "data",
        ]

  const filters: Record<string, any> = {}

  if (q) {
    filters.q = q
  }

  if (channel) {
    filters.channel = channel
  }

  if (status) {
    filters.status = status
  }

  if (id) {
    filters.id = id
  }

  const { data, metadata } = await query.graph({
    entity: "notifications",
    fields: selectedFields,
    filters,
    pagination: {
      skip: offset,
      take: limit,
      order: {
        created_at: "DESC",
      },
    },
  })

  return res.status(200).json({
    notifications: data || [],
    count: metadata?.count ?? (data || []).length,
    offset,
    limit,
  })
}
