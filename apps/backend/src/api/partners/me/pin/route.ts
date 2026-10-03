import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService } from "@medusajs/framework/types"

import { PHONE_PIN_AUTH_PROVIDER } from "../../../../modules/phone-pin-auth"
import { setPartnerAdminPinWorkflow } from "../../../../workflows/partners/set-partner-admin-pin"
import type { SetPartnerMePinInput } from "../validators"

/**
 * POST /partners/me/pin
 * Set the logged-in partner admin's phone-login PIN (#2320).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<SetPartnerMePinInput>,
  res: MedusaResponse
) => {
  const authIdentityId = req.auth_context.auth_identity_id
  if (!authIdentityId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Missing auth identity")
  }

  const { result } = await setPartnerAdminPinWorkflow(req.scope).run({
    input: { authIdentityId, pin: req.validatedBody.pin },
  })
  res.json({ phone: result.phone, pin_set: true })
}

/**
 * GET /partners/me/pin
 * Whether phone login is ready: the number it uses and whether a PIN is set.
 * Never returns the hash.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const authIdentityId = req.auth_context.auth_identity_id
  if (!authIdentityId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Missing auth identity")
  }
  const authModule = req.scope.resolve(Modules.AUTH) as IAuthModuleService
  const [identity] = await authModule.listProviderIdentities({
    auth_identity_id: authIdentityId,
    provider: PHONE_PIN_AUTH_PROVIDER,
  } as any)
  const meta = (identity?.provider_metadata ?? {}) as Record<string, unknown>
  res.json({
    phone: identity?.entity_id ?? null,
    pin_set: Boolean(meta.pin_hash),
    pin_set_at: (meta.pin_set_at as string | undefined) ?? null,
  })
}
