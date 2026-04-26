/**
 * @file Admin API routes for managing form responses
 * @description Provides endpoints for retrieving individual form responses in the JYT Commerce platform
 * @module API/Admin/Forms
 */

/**
 * @typedef {Object} FormResponse
 * @property {string} id - The unique identifier of the form response
 * @property {string} form_id - The ID of the form this response belongs to
 * @property {Object} data - The response data submitted by the user
 * @property {string} customer_id - The ID of the customer who submitted the response
 * @property {Date} created_at - When the response was created
 * @property {Date} updated_at - When the response was last updated
 * @property {string} status - The status of the response (e.g., "pending", "reviewed")
 */

/**
 * Get a specific form response
 * @route GET /admin/forms/:id/responses/:response_id
 * @group Form Response - Operations related to form responses
 * @param {string} id.path.required - The ID of the form
 * @param {string} response_id.path.required - The ID of the form response to retrieve
 * @returns {Object} 200 - The requested form response
 * @throws {MedusaError} 404 - Form response not found
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/forms/web_123456789/responses/resp_987654321
 *
 * @example response 200
 * {
 *   "response": {
 *     "id": "resp_987654321",
 *     "form_id": "web_123456789",
 *     "data": {
 *       "name": "John Doe",
 *       "email": "john.doe@example.com",
 *       "feedback": "Great service!"
 *     },
 *     "customer_id": "cust_1122334455",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "status": "reviewed"
 *   }
 * }
 *
 * @example response 404
 * {
 *   "message": "Response resp_987654321 not found for form web_123456789",
 *   "type": "not_found",
 *   "code": "not_found"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, response_id } = req.params as any

  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY
  ) as Omit<RemoteQueryFunction, symbol>

  const { data } = await query.graph({
    entity: "form_response",
    filters: {
      id: response_id,
      form_id: id,
    },
    fields: ["*"],
    pagination: {
      take: 1,
    },
  })

  const response = (data || [])[0]

  if (!response) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Response ${response_id} not found for form ${id}`
    )
  }

  res.status(200).json({ response })
}
