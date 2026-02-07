
/**
 * API route: /api/admin/forms
 *
 * Handles listing and creating forms in the admin area.
 *
 * GET:
 * - Description: Returns a paginated list of forms filtered by the provided query parameters.
 * - Query Parameters:
 *   - q?: string — full-text search applied to the form title (case-insensitive, partial match)
 *   - status?: string — filter by form status
 *   - website_id?: string — filter forms belonging to a specific website
 *   - domain?: string — filter by domain
 *   - offset?: number — pagination offset (default: 0)
 *   - limit?: number — pagination size (default: 20)
 * - Response (200): { forms: Array<Form>, count: number, offset: number, limit: number }
 * - Example:
 *   @example
 *   curl -X GET "https://your-host/admin/forms?q=contact&status=published&offset=0&limit=10" \
 *     -H "Authorization: Bearer <admin_token>"
 *
 * POST:
 * - Description: Creates a new form using the validated request body.
 * - Request Body: conforms to AdminCreateForm validator (e.g. { title, fields, website_id, domain, status, ... })
 * - Response (201): { form: Form }
 * - Example:
 *   @example
 *   curl -X POST "https://your-host/admin/forms" \
 *     -H "Content-Type: application/json" \
 *     -H "Authorization: Bearer <admin_token>" \
 *     -d '{
 *       "title": "Contact Us",
 *       "website_id": "website_123",
 *       "domain": "example.com",
 *       "status": "draft",
 *       "fields": [
 *         { "id": "name", "type": "text", "label": "Name", "required": true },
 *         { "id": "email", "type": "email", "label": "Email", "required": true }
 *       ]
 *     }'
 *
 * Common parameters:
 * @param req - MedusaRequest for GET: MedusaRequest<AdminListFormsQuery>; for POST: MedusaRequest<AdminCreateForm>
 * @param res - MedusaResponse used to send the HTTP response
 *
 * Notes:
 * - Query parameters are read from req.validatedQuery (fallback to defaults when absent).
 * - POST uses req.validatedBody and returns the created form as `form` in the response body.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createFormWorkflow } from "../../../workflows/forms/create-form"
import { listFormsWorkflow } from "../../../workflows/forms/list-forms"
import {
  AdminCreateForm,
  AdminListFormsQuery,
} from "./validators"

export const GET = async (
  req: MedusaRequest<AdminListFormsQuery>,
  res: MedusaResponse
) => {
  const queryParams = req.validatedQuery || {}

  const filters: Record<string, any> = {}
  if (queryParams.status) {
    filters.status = queryParams.status
  }
  if (queryParams.website_id) {
    filters.website_id = queryParams.website_id
  }
  if (queryParams.domain) {
    filters.domain = queryParams.domain
  }
  if (queryParams.q) {
    filters.title = { $ilike: `%${queryParams.q}%` }
  }

  const { result } = await listFormsWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset || 0,
        take: queryParams.limit || 20,
      },
    },
  })

  res.status(200).json({
    forms: result[0],
    count: result[1],
    offset: queryParams.offset || 0,
    limit: queryParams.limit || 20,
  })
}

export const POST = async (
  req: MedusaRequest<AdminCreateForm>,
  res: MedusaResponse
) => {
  const { result } = await createFormWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  res.status(201).json({ form: result })
}
