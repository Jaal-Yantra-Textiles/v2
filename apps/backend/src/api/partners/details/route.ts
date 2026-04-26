/**
 * @file Partner API route for retrieving partner details
 * @description Provides an endpoint for authenticated partners to retrieve their own details in the JYT Commerce platform
 * @module API/Partners/Details
 */

/**
 * @typedef {Object} PartnerDetailsResponse
 * @property {Object} partner - The partner object containing all details
 * @property {string} partner.id - The unique identifier for the partner
 * @property {string} partner.name - The name of the partner
 * @property {string} partner.email - The email address of the partner
 * @property {string} partner.status - The status of the partner (active/inactive)
 * @property {Date} partner.created_at - When the partner was created
 * @property {Date} [partner.updated_at] - When the partner was last updated
 * @property {Object} [partner.metadata] - Additional metadata about the partner
 */

/**
 * Retrieve authenticated partner details
 * @route GET /partners/details
 * @group Partner - Operations related to partner management
 * @returns {PartnerDetailsResponse} 200 - Partner details object
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 *
 * @example request
 * GET /partners/details
 * Authorization: Bearer {access_token}
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corp",
 *     "email": "contact@acme.com",
 *     "status": "active",
 *     "created_at": "2023-01-15T10:30:00Z",
 *     "updated_at": "2023-05-20T14:45:00Z",
 *     "metadata": {
 *       "industry": "retail",
 *       "tier": "premium"
 *     }
 *   }
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no actor ID"
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no partner found"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import type { IAuthModuleService } from "@medusajs/types"

export const GET = async (
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) => {
    if (!req.auth_context?.actor_id) {
        return res.status(401).json({
            error: "Partner authentication required - no actor ID"
        })
    }

    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)

    if (!partner) {
        return res.status(401).json({
            error: "Partner authentication required - no partner found"
        })
    }

    // Identify the currently logged-in admin by their auth identity email
    let currentAdminId: string | null = null
    if (req.auth_context.auth_identity_id) {
        try {
            const authModule = req.scope.resolve(Modules.AUTH) as IAuthModuleService
            const providerIdentities = await authModule.listProviderIdentities({
                auth_identity_id: req.auth_context.auth_identity_id,
            } as any)
            const emailIdentity = (providerIdentities || []).find(
                (pi: any) => pi.provider === "emailpass"
            )
            if (emailIdentity?.entity_id) {
                const admins = Array.isArray(partner.admins) ? partner.admins : []
                const matchedAdmin = admins.find(
                    (a: any) => a.email?.toLowerCase() === emailIdentity.entity_id.toLowerCase()
                )
                if (matchedAdmin) {
                    currentAdminId = matchedAdmin.id
                }
            }
        } catch {
            // fallback — don't fail the request
        }
    }

    res.json({
        partner,
        current_admin_id: currentAdminId,
    })
}