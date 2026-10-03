import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService } from "@medusajs/framework/types"

import { PHONE_PIN_AUTH_PROVIDER } from "../../modules/phone-pin-auth"
import { hashPin, pinProblem } from "../../modules/phone-pin-auth/pin-hash"

export type SetPartnerAdminPinInput = {
  /** The logged-in admin's auth identity (req.auth_context.auth_identity_id). */
  authIdentityId: string
  pin: string
}

const setPhonePinStep = createStep(
  "set-partner-admin-phone-pin",
  async (input: SetPartnerAdminPinInput, { container }) => {
    const problem = pinProblem(input.pin)
    if (problem) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, problem)
    }

    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    const [identity] = await authModule.listProviderIdentities({
      auth_identity_id: input.authIdentityId,
      provider: PHONE_PIN_AUTH_PROVIDER,
    } as any)
    if (!identity) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Add your phone number to your profile before setting a PIN."
      )
    }

    const before = (identity.provider_metadata ?? {}) as Record<string, unknown>
    await authModule.updateProviderIdentities({
      id: identity.id,
      provider_metadata: {
        ...before,
        pin_hash: await hashPin(input.pin),
        pin_set_at: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
      },
    } as any)

    return new StepResponse(
      { phone: identity.entity_id },
      { id: identity.id, provider_metadata: before }
    )
  },
  async (prev, { container }) => {
    if (!prev) return
    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    await authModule.updateProviderIdentities(prev as any)
  }
)

/**
 * Set (or replace) a partner admin's phone-login PIN (#2320). Needs a phone
 * already saved on their profile — that is what created the `phone-pin`
 * identity. Setting a PIN also clears any lockout from wrong attempts.
 */
export const setPartnerAdminPinWorkflow = createWorkflow(
  "set-partner-admin-pin",
  function (input: SetPartnerAdminPinInput) {
    const result = setPhonePinStep(input)
    return new WorkflowResponse(result)
  }
)

export default setPartnerAdminPinWorkflow
