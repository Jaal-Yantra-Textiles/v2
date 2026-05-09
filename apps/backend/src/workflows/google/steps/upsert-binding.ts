import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import type { GoogleService } from "../../../modules/social-provider/google-connection-service"

export type UpsertBindingInput = {
  platform_id: string
  service: GoogleService
  resource_id: string
  resource_label?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
}

/**
 * Creates a new SocialPlatformBinding row, or updates the existing row when
 * (platform_id, service, resource_id) is already taken — the unique index on
 * the table makes raw `create` brittle and operators repeatedly re-binding
 * the same Merchant ID / Ads CID is a normal flow (e.g. updating settings).
 *
 * Validates the parent platform is `category="google"` so we don't
 * accidentally write Google bindings off a Facebook row.
 */
export const upsertBindingStep = createStep(
  "upsert-google-binding-step",
  async (input: UpsertBindingInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any

    const [platform] = await socials.listSocialPlatforms(
      { id: input.platform_id },
      { take: 1 }
    )
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `SocialPlatform ${input.platform_id} not found`
      )
    }
    if ((platform.category || "").toLowerCase() !== "google") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Platform ${platform.id} is not a Google connection`
      )
    }

    if (!input.resource_id?.trim()) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "resource_id is required")
    }

    const [existing] = await socials.listSocialPlatformBindings(
      {
        platform_id: input.platform_id,
        service: input.service,
        resource_id: input.resource_id,
      },
      { take: 1 }
    )

    if (existing) {
      const updated = await socials.updateSocialPlatformBindings({
        selector: { id: existing.id },
        data: {
          resource_label: input.resource_label ?? existing.resource_label,
          settings: input.settings ?? existing.settings,
          metadata: input.metadata ?? existing.metadata,
          status: "active",
          last_error: null,
        },
      })
      return new StepResponse(Array.isArray(updated) ? updated[0] : updated)
    }

    const created = await socials.createSocialPlatformBindings({
      platform_id: input.platform_id,
      service: input.service,
      resource_id: input.resource_id,
      resource_label: input.resource_label ?? null,
      settings: input.settings ?? null,
      metadata: input.metadata ?? null,
      status: "active",
    })
    return new StepResponse(Array.isArray(created) ? created[0] : created)
  }
)
