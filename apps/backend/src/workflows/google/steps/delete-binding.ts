import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"

export type DeleteBindingInput = {
  platform_id: string
  binding_id: string
}

/**
 * Soft-deletes a binding. Verifies it actually belongs to the parent
 * platform — defensive against URL tampering since the route exposes both
 * IDs in the path.
 */
export const deleteBindingStep = createStep(
  "delete-google-binding-step",
  async (input: DeleteBindingInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any

    const [binding] = await socials.listSocialPlatformBindings(
      { id: input.binding_id, platform_id: input.platform_id },
      { take: 1 }
    )
    if (!binding) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Binding ${input.binding_id} not found under platform ${input.platform_id}`
      )
    }

    await socials.deleteSocialPlatformBindings(input.binding_id)

    return new StepResponse({ id: input.binding_id, deleted: true })
  }
)
