/**
 * @file Partner API route for updating partner information
 * @description Provides endpoints for updating partner details in the JYT Commerce platform
 * @module API/Partners/Update
 */

/**
 * @typedef {Object} PartnerUpdateInput
 * @property {string} [name] - The name of the partner
 * @property {string} [handle] - The unique handle/identifier for the partner
 * @property {string | null} [logo] - URL or path to the partner's logo image
 * @property {"active" | "inactive" | "pending"} [status] - Current status of the partner
 * @property {boolean} [is_verified] - Verification status of the partner
 * @property {Record<string, any> | null} [metadata] - Additional metadata associated with the partner
 */

/**
 * @typedef {Object} PartnerResponse
 * @property {string} id - The unique identifier of the partner
 * @property {string} name - The name of the partner
 * @property {string} handle - The unique handle/identifier for the partner
 * @property {string | null} logo - URL or path to the partner's logo image
 * @property {"active" | "inactive" | "pending"} status - Current status of the partner
 * @property {boolean} is_verified - Verification status of the partner
 * @property {Record<string, any> | null} metadata - Additional metadata associated with the partner
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {Array<Object>} errors - Array of error objects
 * @property {string} errors[].message - Error message
 * @property {string} errors[].code - Error code
 * @property {string} [errors[].field] - Field associated with the error
 */

/**
 * Update partner information
 * @route PUT /partners/update
 * @group Partner - Operations related to partners
 * @param {PartnerUpdateInput} request.body.required - Partner data to update
 * @returns {Object} 200 - Updated partner object
 * @returns {ErrorResponse} 400 - Validation or workflow errors
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 * @throws {MedusaError} 404 - Partner not found for this admin
 *
 * @example request
 * PUT /partners/update
 * {
 *   "name": "Updated Partner Name",
 *   "handle": "updated-partner",
 *   "logo": "https://example.com/logos/updated.png",
 *   "status": "active",
 *   "is_verified": true,
 *   "metadata": {
 *     "preferred_contact": "email",
 *     "industry": "e-commerce"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Updated Partner Name",
 *     "handle": "updated-partner",
 *     "logo": "https://example.com/logos/updated.png",
 *     "status": "active",
 *     "is_verified": true,
 *     "metadata": {
 *       "preferred_contact": "email",
 *       "industry": "e-commerce"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-06-15T12:30:00Z"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "errors": [
 *     {
 *       "message": "Invalid status value",
 *       "code": "invalid_status",
 *       "field": "status"
 *     }
 *   ]
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import updatePartnerWorkflow from "../../../workflows/partners/update-partner"
import { getPartnerFromAuthContext } from "../helpers"

// Update the partner that the current admin belongs to
export const PUT = async (
  req: AuthenticatedMedusaRequest<{
    name?: string
    handle?: string
    logo?: string | null
    status?: "active" | "inactive" | "pending"
    is_verified?: boolean
    metadata?: Record<string, any> | null
  }>,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner not found for this admin"
    )
  }

  const { result, errors } = await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: req.validatedBody || (req.body as any) || {},
    },
  })

  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }

  return res.status(200).json({ partner: result })
}
