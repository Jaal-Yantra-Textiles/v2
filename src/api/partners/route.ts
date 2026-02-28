/**
 * @file Partner API routes for managing partner resources
 * @description Provides endpoints for creating partners in the JYT Commerce platform
 * @module API/Partners
 */

/**
 * @typedef {Object} PartnerAdminInput
 * @property {string} first_name - The first name of the partner admin
 * @property {string} last_name - The last name of the partner admin
 * @property {string} email - The email address of the partner admin
 * @property {string} [phone] - The phone number of the partner admin
 * @property {string} [password] - The password for the partner admin account
 */

/**
 * @typedef {Object} PartnerInput
 * @property {string} name - The name of the partner organization
 * @property {string} [description] - A description of the partner organization
 * @property {string} [website] - The website URL of the partner organization
 * @property {string} [logo_url] - URL to the partner organization's logo
 * @property {string} [status] - The status of the partner (active/inactive/pending)
 * @property {PartnerAdminInput} admin - The admin user details for the partner
 */

/**
 * @typedef {Object} PartnerAdminResponse
 * @property {string} id - The unique identifier for the partner admin
 * @property {string} first_name - The first name of the partner admin
 * @property {string} last_name - The last name of the partner admin
 * @property {string} email - The email address of the partner admin
 * @property {string} [phone] - The phone number of the partner admin
 * @property {Date} created_at - When the admin account was created
 * @property {Date} updated_at - When the admin account was last updated
 */

/**
 * @typedef {Object} PartnerResponse
 * @property {string} id - The unique identifier for the partner
 * @property {string} name - The name of the partner organization
 * @property {string} [description] - A description of the partner organization
 * @property {string} [website] - The website URL of the partner organization
 * @property {string} [logo_url] - URL to the partner organization's logo
 * @property {string} status - The status of the partner (active/inactive/pending)
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 * @property {PartnerAdminResponse} admin - The admin user associated with the partner
 */

/**
 * Create a new partner with an admin user
 * @route POST /partners
 * @group Partner - Operations related to partners
 * @param {PartnerInput} request.body.required - Partner and admin data to create
 * @returns {Object} 200 - Created partner object with admin details
 * @throws {MedusaError} 400 - Invalid input data or request already authenticated as a partner
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 * @throws {MedusaError} 500 - Internal server error during partner creation
 *
 * @example request
 * POST /partners
 * {
 *   "name": "Acme Corporation",
 *   "description": "A leading provider of innovative solutions",
 *   "website": "https://acme.com",
 *   "logo_url": "https://acme.com/logo.png",
 *   "status": "active",
 *   "admin": {
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john.doe@acme.com",
 *     "phone": "+1234567890",
 *     "password": "securePassword123!"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corporation",
 *     "description": "A leading provider of innovative solutions",
 *     "website": "https://acme.com",
 *     "logo_url": "https://acme.com/logo.png",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "admin": {
 *       "id": "admin_987654321",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "email": "john.doe@acme.com",
 *       "phone": "+1234567890",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   }
 * }
 */
import { 
    AuthenticatedMedusaRequest, 
    MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import createPartnerAdminWorkflow from "../../workflows/partner/create-partner-admin"
import { partnerSchema } from "./validators"
import type { z } from "@medusajs/framework/zod"
import { refetchPartner } from "./helpers"

type RequestBody = z.infer<typeof partnerSchema>

export const POST = async (
    req: AuthenticatedMedusaRequest<RequestBody>,
    res: MedusaResponse
) => {
    // If actor_id is present, the request carries 
    // authentication for an existing partner admin
    if (req.auth_context?.actor_id) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Request already authenticated as a partner."
        )
    }

    const { admin, ...partnerData } = partnerSchema.parse(req.body)

    const authIdentityId = req.auth_context?.auth_identity_id
    if (!authIdentityId) {
        throw new MedusaError(
            MedusaError.Types.UNAUTHORIZED,
            "Partner authentication required"
        )
    }

    // Create partner and admin using workflow
    const { result } = await createPartnerAdminWorkflow(req.scope)
        .run({
            input: {
                partner: partnerData,
                admin,
                authIdentityId,
            },
        })

    // Refetch partner with admin details
    const partnerWithAdmin = await refetchPartner(result.createdPartner.id, req.scope)

    res.json({
        partner: partnerWithAdmin,
    })
}



