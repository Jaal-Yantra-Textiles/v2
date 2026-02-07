/**
 * @file Admin API routes for managing notifications
 * @description Provides endpoints for retrieving notifications in the JYT Commerce platform
 * @module API/Admin/Notifications
 */

/**
 * @typedef {Object} Notification
 * @property {string} id - The unique identifier of the notification
 * @property {string} title - The title of the notification
 * @property {string} message - The content of the notification
 * @property {string} type - The type of notification (e.g., "info", "warning", "error")
 * @property {boolean} is_read - Whether the notification has been read
 * @property {Date} created_at - When the notification was created
 * @property {Date} updated_at - When the notification was last updated
 * @property {Object} metadata - Additional metadata associated with the notification
 */

/**
 * @typedef {Object} PaginatedNotifications
 * @property {Notification[]} notifications - List of notifications
 * @property {number} count - Total number of notifications
 * @property {number} offset - Pagination offset
 * @property {number} limit - Number of items per page
 */

/**
 * List notifications with pagination
 * @route GET /admin/notifications
 * @group Notification - Operations related to notifications
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return
 * @param {string} [type] - Filter notifications by type (e.g., "info", "warning", "error")
 * @param {boolean} [is_read] - Filter notifications by read status
 * @returns {PaginatedNotifications} 200 - Paginated list of notifications
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/notifications?offset=0&limit=10&type=info&is_read=false
 *
 * @example response 200
 * {
 *   "notifications": [
 *     {
 *       "id": "notif_123456789",
 *       "title": "New Order Received",
 *       "message": "A new order has been placed and is awaiting fulfillment.",
 *       "type": "info",
 *       "is_read": false,
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "metadata": {
 *         "order_id": "order_987654321"
 *       }
 *     }
 *   ],
 *   "count": 50,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
export { GET } from "./custom/route"
