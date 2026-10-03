import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"
import { resolvePartnerAdminAuthIdentityStep } from "./steps/resolve-partner-admin-auth-identity"
import { syncPartnerAdminPhoneIdentityStep } from "./steps/sync-partner-admin-phone-identity"

export type UpdatePartnerAdminInput = {
  id: string
  update: {
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
    role?: "owner" | "admin" | "manager"
    preferred_language?: string | null
    is_active?: boolean
  }
}

const updatePartnerAdminRowStep = createStep(
  "update-partner-admin-row",
  async (input: UpdatePartnerAdminInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const keys = Object.keys(input.update)
    const [before] = await partnerService.listPartnerAdmins(
      { id: input.id },
      { select: ["id", ...keys] } as any
    )
    const updated = await partnerService.updatePartnerAdmins({
      id: input.id,
      ...input.update,
    } as any)
    const admin = Array.isArray(updated) ? updated[0] : updated
    return new StepResponse(admin, before ?? null)
  },
  async (before, { container }) => {
    if (!before) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartnerAdmins(before as any)
  }
)

/**
 * Update a partner admin's profile. When `phone` changes it is normalised to
 * E.164 and the admin's `phone-pin` login identity follows it (#2320) —
 * the identity is synced FIRST so a number already taken fails before the row
 * is touched.
 */
export const updatePartnerAdminWorkflow = createWorkflow(
  "update-partner-admin",
  function (input: UpdatePartnerAdminInput) {
    const phoneChanged = transform({ input }, ({ input }) => "phone" in input.update)

    const synced = when("sync-admin-phone", { phoneChanged }, ({ phoneChanged }) => phoneChanged).then(
      function () {
        const { authIdentityId } = resolvePartnerAdminAuthIdentityStep({ adminId: input.id })
        return syncPartnerAdminPhoneIdentityStep({
          authIdentityId,
          phone: input.update.phone,
        })
      }
    )

    const rowInput = transform({ input, synced }, ({ input, synced }) => {
      if (!("phone" in input.update)) return input
      // The sync step validated the number; store its E.164 form (or null).
      return { ...input, update: { ...input.update, phone: synced?.phone ?? null } }
    })

    const admin = updatePartnerAdminRowStep(rowInput)
    return new WorkflowResponse(admin)
  }
)

export default updatePartnerAdminWorkflow
