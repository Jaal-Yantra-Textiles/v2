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
import { PRODUCTION_POLICY_MODULE } from "../../../modules/production_policy"
import type ProductionPolicyService from "../../../modules/production_policy/service"

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

    // #1228 — the partner's `auto_accept_production_runs` opt-in is gated a
    // SECOND time by the platform's reassignment policy. Without shipping the
    // gate's state the settings switch can promise something the platform will
    // not do: a partner turns it on, is told re-sent runs will be accepted for
    // them, and they never are. Read-only, and deliberately just the one flag
    // the partner UI can act on.
    //
    // ⚠️ This comment used to end "and on prod that gate is off". That was a
    // STATE, not an invariant, and it drifted — prod reads
    // `auto_accept_on_retry = true` (probed live, #1575). Someone reading it
    // reasonably concluded the gate was why auto-accept never fires. It is not:
    // nothing auto-accepts at DISPATCH at all, only inside the reminder RETRY
    // branch, which is the agreed behaviour. Do not record a prod value here
    // again; probe it.
    let productionRunPolicy: { auto_accept_on_retry: boolean } | null = null
    try {
        const policyService: ProductionPolicyService = req.scope.resolve(
            PRODUCTION_POLICY_MODULE
        )
        const reassignment = await policyService.getReassignmentPolicy()
        productionRunPolicy = {
            auto_accept_on_retry: reassignment.auto_accept_on_retry,
        }
    } catch {
        // The partner's own details must not fail because the platform policy
        // is unreadable. `null` means "unknown", which the UI states as such
        // rather than claiming the switch works.
    }

    res.json({
        partner,
        current_admin_id: currentAdminId,
        production_run_policy: productionRunPolicy,
    })
}