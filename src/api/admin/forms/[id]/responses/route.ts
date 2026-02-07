/**
 * @file Admin API routes for managing form responses
 * @description Provides endpoints for retrieving form responses in the JYT Commerce platform
 * @module API/Admin/Forms
 */

/**
 * @typedef {Object} AdminListFormResponsesQuery
 * @property {string} [status] - Filter responses by status
 * @property {string} [email] - Filter responses by email (exact match)
 * @property {string} [q] - Search term to filter responses by email (partial match)
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=20] - Number of items to return per page
 */

/**
 * @typedef {Object} FormResponse
 * @property {string} id - The unique identifier of the form response
 * @property {string} form_id - The ID of the form this response belongs to
 * @property {string} email - The email address of the respondent
 * @property {string} status - The status of the response (e.g., "pending", "approved", "rejected")
 * @property {Object} data - The response data submitted by the user
 * @property {Date} created_at - When the response was created
 * @property {Date} updated_at - When the response was last updated
 */

/**
 * @typedef {Object} ListFormResponsesResult
 * @property {FormResponse[]} responses - Array of form responses
 * @property {number} count - Total count of responses matching the filters
 * @property {number} offset - The current pagination offset
 * @property {number} limit - The number of items returned per page
 */

/**
 * List form responses with pagination and filtering
 * @route GET /admin/forms/:id/responses
 * @group Form Responses - Operations related to form responses
 * @param {string} id.path.required - The ID of the form to retrieve responses for
 * @param {string} [status] - Filter responses by status
 * @param {string} [email] - Filter responses by email (exact match)
 * @param {string} [q] - Search term to filter responses by email (partial match)
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of items to return per page
 * @returns {ListFormResponsesResult} 200 - Paginated list of form responses
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Form not found
 *
 * @example request
 * GET /admin/forms/form_123456789/responses?status=pending&offset=0&limit=10
 *
 * @example response 200
 * {
 *   "responses": [
 *     {
 *       "id": "resp_987654321",
 *       "form_id": "form_123456789",
 *       "email": "user@example.com",
 *       "status": "pending",
 *       "data": {
 *         "name": "John Doe",
 *         "feedback": "Great product!"
 *       },
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { listFormResponsesWorkflow } from "../../../../../workflows/forms/list-form-responses"
import { AdminListFormResponsesQuery } from "../../validators"

export const GET = async (
  req: MedusaRequest<AdminListFormResponsesQuery>,
  res: MedusaResponse
) => {
  const queryParams = req.validatedQuery || {}

  const filters: Record<string, any> = {
    form_id: req.params.id,
  }

  if (queryParams.status) {
    filters.status = queryParams.status
  }

  if (queryParams.email) {
    filters.email = { $ilike: `%${queryParams.email}%` }
  }

  if (queryParams.q) {
    filters.email = { $ilike: `%${queryParams.q}%` }
  }

  const { result } = await listFormResponsesWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset || 0,
        take: queryParams.limit || 20,
      },
    },
  })

  res.status(200).json({
    responses: result[0],
    count: result[1],
    offset: queryParams.offset || 0,
    limit: queryParams.limit || 20,
  })
}
