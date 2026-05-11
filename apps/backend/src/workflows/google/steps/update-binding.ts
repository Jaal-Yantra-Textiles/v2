import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"

export type UpdateBindingInput = {
  platform_id: string
  binding_id: string
  resource_label?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
  status?: "active" | "paused" | "error" | "pending"
}

/**
 * Patches mutable fields on an existing SocialPlatformBinding. Most common
 * use is setting `settings.login_customer_id` on an Ads binding that was
 * created before the manager hierarchy was auto-discovered.
 *
 * `settings` and `metadata` are merged shallow into the existing JSON so
 * callers can update one key without clobbering the rest.
 */
export const updateBindingStep = createStep(
  "update-google-binding-step",
  async (input: UpdateBindingInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any

    const [existing] = await socials.listSocialPlatformBindings(
      { id: input.binding_id, platform_id: input.platform_id },
      { take: 1 }
    )
    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Binding ${input.binding_id} not found on platform ${input.platform_id}`
      )
    }

    const data: Record<string, any> = {}
    if (input.resource_label !== undefined) {
      data.resource_label = input.resource_label
    }
    if (input.settings !== undefined) {
      data.settings =
        input.settings === null
          ? null
          : { ...(existing.settings || {}), ...input.settings }
    }
    if (input.metadata !== undefined) {
      data.metadata =
        input.metadata === null
          ? null
          : { ...(existing.metadata || {}), ...input.metadata }
    }
    if (input.status !== undefined) {
      data.status = input.status
    }

    if (Object.keys(data).length === 0) {
      return new StepResponse(existing)
    }

    const updated = await socials.updateSocialPlatformBindings({
      selector: { id: existing.id },
      data,
    })
    return new StepResponse(Array.isArray(updated) ? updated[0] : updated)
  }
)
