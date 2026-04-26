/**
 * @file Admin API routes for managing partners
 * @description Provides endpoints for listing and searching partners in the JYT Commerce platform
 * @module API/Admin/Persons/Partner
 */

/**
 * @typedef {Object} AdminGetPartnersParams
 * @property {string} [q] - Search query to filter partners by name or handle
 * @property {string} [name] - Filter partners by name (partial match)
 * @property {string} [handle] - Filter partners by handle (partial match)
 * @property {string} [status] - Filter partners by status
 * @property {string} [is_verified] - Filter partners by verification status (true/false)
 * @property {string} [fields] - Comma-separated list of fields to include in response
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=20] - Number of items to return per page
 */

/**
 * @typedef {Object} PartnerResponse
 * @property {string} id - The unique identifier for the partner
 * @property {string} partner_id - The partner ID (same as id)
 * @property {string} name - The name of the partner
 * @property {string} handle - The unique handle for the partner
 * @property {string} logo - URL to the partner's logo
 * @property {string} status - The current status of the partner
 * @property {boolean} is_verified - Whether the partner is verified
 * @property {Object} metadata - Additional metadata about the partner
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 */

/**
 * @typedef {Object} PartnersListResponse
 * @property {PartnerResponse[]} partners - Array of partner objects
 * @property {number} count - Total number of partners matching the query
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Number of items returned per page
 */

/**
 * List and search partners with pagination
 * @route GET /admin/persons/partner
 * @group Partner - Operations related to partners
 * @param {string} [q] - Search query to filter partners by name or handle
 * @param {string} [name] - Filter partners by name (partial match)
 * @param {string} [handle] - Filter partners by handle (partial match)
 * @param {string} [status] - Filter partners by status
 * @param {string} [is_verified] - Filter partners by verification status (true/false)
 * @param {string} [fields] - Comma-separated list of fields to include in response
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of items to return per page
 * @returns {PartnersListResponse} 200 - Paginated list of partners matching the query
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/persons/partner?q=design&status=active&offset=0&limit=10
 *
 * @example response 200
 * {
 *   "partners": [
 *     {
 *       "id": "partner_123456789",
 *       "partner_id": "partner_123456789",
 *       "name": "Design Studio",
 *       "handle": "design-studio",
 *       "logo": "https://example.com/logos/design-studio.png",
 *       "status": "active",
 *       "is_verified": true,
 *       "metadata": {
 *         "specialty": "UI/UX Design",
 *         "location": "San Francisco"
 *       },
 *       "created_at": "2023-01-15T10:30:00Z",
 *       "updated_at": "2023-05-20T14:45:00Z"
 *     },
 *     {
 *       "id": "partner_987654321",
 *       "partner_id": "partner_987654321",
 *       "name": "Creative Designs",
 *       "handle": "creative-designs",
 *       "logo": "https://example.com/logos/creative-designs.png",
 *       "status": "active",
 *       "is_verified": false,
 *       "metadata": {
 *         "specialty": "Branding",
 *         "location": "New York"
 *       },
 *       "created_at": "2022-11-05T08:15:00Z",
 *       "updated_at": "2023-03-10T16:20:00Z"
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AdminGetPartnersParamsSchema, AdminGetPartnersParamsType } from "./validators"
import { listPartnersWorkflow } from "../../../../workflows/partners/list-partners"

export const GET = async (
  req: MedusaRequest<AdminGetPartnersParamsType>,
  res: MedusaResponse
) => {
  const validatedQuery = AdminGetPartnersParamsSchema.parse(req.query)
  
  // Build filters from query parameters
  const filters: Record<string, any> = {}
  
  if (validatedQuery.q) {
    // Search across partner fields
    filters.$or = [
      { "name": { $ilike: `%${validatedQuery.q}%` } },
      { "handle": { $ilike: `%${validatedQuery.q}%` } },
    ]
  }
  
  if (validatedQuery.name) {
    filters.name = { $ilike: `%${validatedQuery.name}%` }
  }
  
  if (validatedQuery.handle) {
    filters.handle = { $ilike: `%${validatedQuery.handle}%` }
  }
  
  if (validatedQuery.status) {
    filters.status = validatedQuery.status
  }
  
  if (validatedQuery.is_verified !== undefined) {
    filters.is_verified = validatedQuery.is_verified === 'true'
  }

  const { result } = await listPartnersWorkflow(req.scope).run({
    input: {
      filters,
      fields: validatedQuery.fields,
      offset: validatedQuery.offset,
      limit: validatedQuery.limit,
    },
  })

  const partners = result.data.map((item: any) => ({
    id: item.id,
    partner_id: item.id,
    name: item.name,
    handle: item.handle,
    logo: item.logo,
    status: item.status,
    is_verified: item.is_verified,
    metadata: item.metadata,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }))

  return res.json({
    partners,
    count: result.metadata?.count || partners.length,
    offset: validatedQuery.offset || 0,
    limit: validatedQuery.limit || 20,
  })
}