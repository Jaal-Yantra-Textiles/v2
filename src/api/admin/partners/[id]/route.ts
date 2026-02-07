/**
 * @file Admin API routes for managing partners
 * @description Provides endpoints for retrieving and updating partner information in the JYT Commerce platform
 * @module API/Admin/Partners
 */

/**
 * @typedef {Object} ListPartnersQuerySchema
 * @property {string} [fields] - Comma-separated list of fields to include in the response
 */

/**
 * @typedef {Object} PartnerResponse
 * @property {string} id - The unique identifier of the partner
 * @property {string} name - The name of the partner
 * @property {string} handle - The unique handle of the partner
 * @property {string} [logo] - URL to the partner's logo
 * @property {string} status - The status of the partner (active/inactive/pending)
 * @property {boolean} is_verified - Whether the partner is verified
 * @property {Object} [metadata] - Additional metadata about the partner
 * @property {Object[]} admins - List of admin users associated with the partner
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 */

/**
 * @typedef {Object} UpdatePartnerInput
 * @property {string} [name] - The name of the partner
 * @property {string} [handle] - The unique handle of the partner
 * @property {string} [logo] - URL to the partner's logo
 * @property {string} [status] - The status of the partner (active/inactive/pending)
 * @property {boolean} [is_verified] - Whether the partner is verified
 * @property {Object} [metadata] - Additional metadata about the partner
 * @property {string} [admin_id] - ID of the admin user to associate with the partner
 * @property {string} [admin_password] - Password for the admin user
 */

/**
 * Get a single partner by ID
 * @route GET /admin/partners/:id
 * @group Partner - Operations related to partners
 * @param {string} id.path.required - The ID of the partner to retrieve
 * @param {string} [fields] - Comma-separated list of fields to include in the response
 * @returns {Object} 200 - Partner object
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * GET /admin/partners/partner_123456789?fields=name,handle,status
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corp",
 *     "handle": "acme",
 *     "logo": "https://example.com/logo.png",
 *     "status": "active",
 *     "is_verified": true,
 *     "metadata": {
 *       "industry": "retail",
 *       "tier": "premium"
 *     },
 *     "admins": [
 *       {
 *         "id": "admin_987654321",
 *         "email": "admin@acme.com",
 *         "first_name": "John",
 *         "last_name": "Doe"
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-05-15T10:30:00Z"
 *   }
 * }
 */

/**
 * Update a partner by ID
 * @route PUT /admin/partners/:id
 * @group Partner - Operations related to partners
 * @param {string} id.path.required - The ID of the partner to update
 * @param {UpdatePartnerInput} request.body.required - Partner data to update
 * @returns {Object} 200 - Updated partner object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * PUT /admin/partners/partner_123456789
 * {
 *   "name": "Acme Corporation",
 *   "status": "active",
 *   "is_verified": true,
 *   "metadata": {
 *     "industry": "retail",
 *     "tier": "premium",
 *     "region": "north_america"
 *   },
 *   "admin_id": "admin_987654321",
 *   "admin_password": "securePassword123!"
 * }
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corporation",
 *     "handle": "acme",
 *     "logo": "https://example.com/logo.png",
 *     "status": "active",
 *     "is_verified": true,
 *     "metadata": {
 *       "industry": "retail",
 *       "tier": "premium",
 *       "region": "north_america"
 *     },
 *     "admins": [
 *       {
 *         "id": "admin_987654321",
 *         "email": "admin@acme.com",
 *         "first_name": "John",
 *         "last_name": "Doe"
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-05-15T11:45:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import listSinglePartnerWorkflow from "../../../../workflows/partners/list-single-partner"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"
import { ListPartnersQuerySchema } from "../validators"

// Get a single partner by id
export const GET = async (
  req: MedusaRequest<ListPartnersQuerySchema>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const vq = (req as any).validatedQuery as ListPartnersQuerySchema | undefined
  const fields = (() => {
    const f = vq?.fields as unknown as string | string[] | undefined
    let arr: string[] | undefined
    if (typeof f === "string") {
      arr = f.split(",").map((s) => s.trim()).filter(Boolean)
    } else if (Array.isArray(f)) {
      arr = f
    }
    // Always include defaults
    const defaults = ["*", "admins.*"]
    const finalSet = new Set([...(arr || []), ...defaults])
    const final = Array.from(finalSet)
    return final.length ? final : undefined
  })()
  const { result } = await listSinglePartnerWorkflow(req.scope).run({
    input: {
      id,
      fields,
    },
  })

  res.status(200).json({ partner: result })
}

// Update a partner by id
export const PUT = async (
  req: MedusaRequest<{
    name?: string
    handle?: string
    logo?: string | null
    status?: "active" | "inactive" | "pending"
    is_verified?: boolean
    metadata?: Record<string, any> | null
    admin_id?: string
    admin_password?: string
  }>,
  res: MedusaResponse
) => {
  const id = req.params.id

  const body = (req.validatedBody || (req.body as any) || {}) as any
  const { admin_id, admin_password, ...partnerData } = body

  const { result, errors } = await updatePartnerWorkflow(req.scope).run({
    input: {
      id,
      admin_id,
      admin_password,
      data: partnerData,
    },
  })

  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }

  res.status(200).json({ partner: result })
}
