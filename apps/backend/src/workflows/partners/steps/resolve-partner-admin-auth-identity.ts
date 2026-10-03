import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService } from "@medusajs/framework/types"

import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"

/**
 * Find a partner admin's auth identity: the one whose emailpass identity is the
 * admin's email (the same pairing `/partners/me` relies on), and whose
 * `app_metadata.partner_id` is the admin's partner. Returns null when the admin
 * has never had a login.
 */
export async function findPartnerAdminAuthIdentityId(
  container: any,
  admin: { email?: string | null; partner_id?: string | null }
): Promise<string | null> {
  if (!admin.email) return null
  const authModule = container.resolve(Modules.AUTH) as IAuthModuleService

  const candidates = Array.from(new Set([admin.email, admin.email.toLowerCase()]))
  const identities = await authModule.listProviderIdentities({
    provider: "emailpass",
    entity_id: candidates,
  } as any)
  if (!identities.length) return null

  const authIdentities = await authModule.listAuthIdentities({
    id: identities.map((i: any) => i.auth_identity_id),
  } as any)
  const match = authIdentities.find(
    (a: any) => !admin.partner_id || a.app_metadata?.partner_id === admin.partner_id
  )
  return match?.id ?? null
}

export const resolvePartnerAdminAuthIdentityStep = createStep(
  "resolve-partner-admin-auth-identity",
  async (input: { adminId: string }, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const [admin] = await partnerService.listPartnerAdmins(
      { id: input.adminId },
      { select: ["id", "email", "partner_id"] } as any
    )
    if (!admin) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner admin ${input.adminId} not found`
      )
    }
    const authIdentityId = await findPartnerAdminAuthIdentityId(container, admin as any)
    return new StepResponse({ authIdentityId })
  }
)
