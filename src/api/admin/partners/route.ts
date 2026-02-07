/**
 * @file Admin API routes for managing partners
 * @description Provides endpoints for creating and listing partners in the JYT Commerce platform
 * @module API/Admin/Partners
 */

/**
 * @typedef {Object} PartnerQueryParams
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=20] - Number of items to return
 * @property {string} [name] - Filter by partner name
 * @property {string} [handle] - Filter by partner handle
 * @property {"active"|"inactive"|"pending"} [status] - Filter by partner status
 * @property {boolean} [is_verified] - Filter by verification status
 */

/**
 * @typedef {Object} Partner
 * @property {string} id - The unique identifier
 * @property {string} name - The name of the partner
 * @property {string} handle - The unique handle of the partner
 * @property {"active"|"inactive"|"pending"} status - The status of the partner
 * @property {boolean} is_verified - Whether the partner is verified
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 */

/**
 * @typedef {Object} PartnerAdminInput
 * @property {string} first_name - The first name of the admin
 * @property {string} last_name - The last name of the admin
 * @property {string} email - The email of the admin
 * @property {string} [phone] - The phone number of the admin
 */

/**
 * @typedef {Object} PartnerInput
 * @property {string} name - The name of the partner
 * @property {string} handle - The unique handle of the partner
 * @property {string} [description] - The description of the partner
 * @property {string} [website] - The website of the partner
 * @property {string} [logo_url] - The logo URL of the partner
 * @property {string} [industry] - The industry of the partner
 */

/**
 * @typedef {Object} PostPartnerWithAdminSchema
 * @property {PartnerInput} partner - The partner data to create
 * @property {PartnerAdminInput} admin - The primary admin data to create
 */

/**
 * @typedef {Object} PartnerAdmin
 * @property {string} id - The unique identifier
 * @property {string} first_name - The first name of the admin
 * @property {string} last_name - The last name of the admin
 * @property {string} email - The email of the admin
 * @property {string} [phone] - The phone number of the admin
 * @property {Date} created_at - When the admin was created
 * @property {Date} updated_at - When the admin was last updated
 */

/**
 * @typedef {Object} PartnerWithAdminResponse
 * @property {Partner} partner - The created partner object
 * @property {PartnerAdmin} partner_admin - The created partner admin object
 */

/**
 * List partners with pagination and filtering
 * @route GET /admin/partners
 * @group Partner - Operations related to partners
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of items to return
 * @param {string} [name] - Filter by partner name
 * @param {string} [handle] - Filter by partner handle
 * @param {"active"|"inactive"|"pending"} [status] - Filter by partner status
 * @param {boolean} [is_verified] - Filter by verification status
 * @returns {Object} 200 - Paginated list of partners
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * GET /admin/partners?offset=0&limit=10&status=active
 *
 * @example response 200
 * {
 *   "partners": [
 *     {
 *       "id": "partner_123456789",
 *       "name": "Acme Corp",
 *       "handle": "acme",
 *       "status": "active",
 *       "is_verified": true,
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */

/**
 * Create a new partner with primary admin
 * @route POST /admin/partners
 * @group Partner - Operations related to partners
 * @param {PostPartnerWithAdminSchema} request.body.required - Partner and admin data to create
 * @returns {PartnerWithAdminResponse} 201 - Created partner and admin objects
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 409 - Conflict (e.g., duplicate handle or email)
 *
 * @example request
 * POST /admin/partners
 * {
 *   "partner": {
 *     "name": "Acme Corp",
 *     "handle": "acme",
 *     "description": "A leading provider of solutions",
 *     "website": "https://acme.com",
 *     "logo_url": "https://acme.com/logo.png",
 *     "industry": "Technology"
 *   },
 *   "admin": {
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john.doe@acme.com",
 *     "phone": "+1234567890"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corp",
 *     "handle": "acme",
 *     "status": "pending",
 *     "is_verified": false,
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   },
 *   "partner_admin": {
 *     "id": "admin_987654321",
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john.doe@acme.com",
 *     "phone": "+1234567890",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listPartnersWorkflow } from "../../../workflows/partners/list-partners"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createPartnerAdminWithRegistrationWorkflow } from "../../../workflows/partner/create-partner-admin"
import { PostPartnerWithAdminSchema } from "./validators"

export const GET = async (
  req: MedusaRequest & {
    query?: {
      offset?: number
      limit?: number
      name?: string
      handle?: string
      status?: "active" | "inactive" | "pending"
      is_verified?: boolean
    }
  },
  res: MedusaResponse
) => {
  const offset = Number(req.query?.offset ?? 0)
  const limit = Number(req.query?.limit ?? 20)

  const { result } = await listPartnersWorkflow(req.scope).run({
    input: {
      fields: req.queryConfig?.fields || ["*"],
      filters: {
        name: req.query?.name,
        handle: req.query?.handle,
        status: req.query?.status,
        is_verified: req.query?.is_verified,
      },
      offset,
      limit,
    },
  })

  const partners = (result as any)?.data || []
  const metadata = (result as any)?.metadata || {}

  res.status(200).json({
    partners,
    count: metadata?.count ?? partners.length,
    offset,
    limit,
  })
}

// POST /admin/partners - create partner with primary admin
export const POST = async (
  req: MedusaRequest<PostPartnerWithAdminSchema>,
  res: MedusaResponse
) => {
  const { partner: partnerInput, admin: adminInput } = req.validatedBody

  // Use internal workflow that registers auth identity and links it
  const { result, errors } = await createPartnerAdminWithRegistrationWorkflow(req.scope).run({
    input: {
      partner: partnerInput,
      admin: adminInput,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to create partner admin"
      )
    )
  }

  const payload = result as any

  // Emit partner.created.fromAdmin with the workflow-provided temp password
  const eventService = req.scope.resolve(Modules.EVENT_BUS)
  console.log("Emitting partner.created.fromAdmin event",payload)
  eventService.emit({
    name: "partner.created.fromAdmin",
    data: {
      partner_id: payload.partnerWithAdmin.createdPartner.id,
      partner_admin_id: payload.partnerWithAdmin.partnerAdmin.id,
      email: adminInput.email,
      temp_password: payload.registered.tempPassword,
    },
  })

  return res.status(201).json({
    partner: payload.partnerWithAdmin.createdPartner,
    partner_admin: payload.partnerWithAdmin.partnerAdmin,
  })
}
