import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService } from "@medusajs/types"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"
import { getPartnerFromAuthContext } from "../helpers"

const resolveCurrentAdmin = async (
  req: AuthenticatedMedusaRequest
): Promise<{ partner: any; admin: any }> => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const authIdentityId = req.auth_context.auth_identity_id
  if (!authIdentityId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Missing auth identity"
    )
  }

  const authModule = req.scope.resolve(Modules.AUTH) as IAuthModuleService
  const providerIdentities = await authModule.listProviderIdentities({
    auth_identity_id: authIdentityId,
  } as any)
  const emailIdentity = (providerIdentities || []).find(
    (pi: any) => pi.provider === "emailpass"
  )
  const email = emailIdentity?.entity_id
  if (!email) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No email identity on session"
    )
  }

  const admins = Array.isArray(partner.admins) ? partner.admins : []
  const admin = admins.find(
    (a: any) => a?.email?.toLowerCase() === email.toLowerCase()
  )
  if (!admin) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Admin not found for current session"
    )
  }

  return { partner, admin }
}

/**
 * GET /partners/me
 * Return the currently authenticated partner admin.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { admin, partner } = await resolveCurrentAdmin(req)
  res.json({ admin, partner_id: partner.id })
}

type UpdateMePayload = {
  first_name?: string
  last_name?: string
  phone?: string | null
  preferred_language?: string | null
}

const ALLOWED_FIELDS: (keyof UpdateMePayload)[] = [
  "first_name",
  "last_name",
  "phone",
  "preferred_language",
]

/**
 * PATCH /partners/me
 * Update the currently authenticated partner admin's profile.
 */
export const PATCH = async (
  req: AuthenticatedMedusaRequest<UpdateMePayload>,
  res: MedusaResponse
) => {
  const { admin } = await resolveCurrentAdmin(req)

  const body = (req.validatedBody || req.body || {}) as UpdateMePayload
  const update: Record<string, any> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) update[key] = body[key]
  }

  if (Object.keys(update).length === 0) {
    res.json({ admin })
    return
  }

  const partnerService: PartnerService = req.scope.resolve(PARTNER_MODULE)
  const updated = await partnerService.updatePartnerAdmins({
    id: admin.id,
    ...update,
  } as any)

  const updatedAdmin = Array.isArray(updated) ? updated[0] : updated
  res.json({ admin: updatedAdmin })
}
