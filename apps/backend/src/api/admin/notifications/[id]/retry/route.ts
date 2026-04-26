/**
 * @file Admin API route for retrying failed email notifications
 * @description Provides an endpoint to retry sending failed email notifications in the JYT Commerce platform
 * @module API/Admin/Notifications
 */

/**
 * @typedef {Object} RetryEmailRequest
 * @property {string} notificationId.required - The ID of the failed notification to retry
 * @property {string} to.required - The recipient email address
 * @property {string} template.required - The email template to use for the retry
 * @property {Record<string, any>} [data] - Additional data to pass to the email template
 */

/**
 * @typedef {Object} RetryEmailSuccessResponse
 * @property {string} message - Success message
 * @property {Object} result - The result of the retry operation
 */

/**
 * @typedef {Object} RetryEmailErrorResponse
 * @property {string} error - Error message
 * @property {Array} [details] - Detailed error information
 * @property {string} [message] - Additional error details
 */

/**
 * Retry sending a failed email notification
 * @route POST /admin/notifications/{id}/retry
 * @group Notifications - Operations related to notifications
 * @param {string} id.path.required - The ID of the notification to retry
 * @param {RetryEmailRequest} request.body.required - Email retry data
 * @returns {RetryEmailSuccessResponse} 200 - Email retry initiated successfully
 * @throws {MedusaError} 400 - Missing required fields
 * @throws {MedusaError} 500 - Failed to retry email or internal server error
 *
 * @example request
 * POST /admin/notifications/notif_123456789/retry
 * {
 *   "notificationId": "notif_123456789",
 *   "to": "customer@example.com",
 *   "template": "order_confirmation",
 *   "data": {
 *     "orderId": "order_987654321",
 *     "total": 99.99
 *   }
 * }
 *
 * @example response 200
 * {
 *   "message": "Email retried successfully",
 *   "result": {
 *     "id": "email_123456789",
 *     "status": "queued",
 *     "created_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "Missing required fields: notificationId, to, template"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to retry email",
 *   "details": [
 *     {
 *       "message": "Template not found",
 *       "code": "TEMPLATE_NOT_FOUND"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryFailedEmailWorkflow } from "../../../../../workflows/email/workflows/retry-failed-email"

interface RetryEmailRequest {
  notificationId: string
  to: string
  template: string
  data?: Record<string, any>
}

export const POST = async (
  req: MedusaRequest<RetryEmailRequest>, 
  res: MedusaResponse
) => {
  const { notificationId, to, template, data } = req.body

  if (!notificationId || !to || !template) {
    return res.status(400).json({
      error: "Missing required fields: notificationId, to, template"
    })
  }

  try {
    const { result, errors } = await retryFailedEmailWorkflow(req.scope).run({
      input: {
        to,
        template,
        data,
        originalNotificationId: notificationId
      },
      throwOnError: false
    })

    if (errors.length > 0) {
      return res.status(500).json({
        error: "Failed to retry email",
        details: errors
      })
    }

    return res.status(200).json({
      message: "Email retried successfully",
      result
    })
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    })
  }
}
