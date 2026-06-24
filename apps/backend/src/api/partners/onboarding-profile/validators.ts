import { z } from "@medusajs/framework/zod"

/**
 * Validator for PUT /partners/onboarding-profile (issue #648, slice 1).
 *
 * Every field is optional so the wizard can save partial progress per step.
 * Enums are pinned to the model's allowed values — garbage is rejected.
 */
export const onboardingProfileUpdateSchema = z
  .object({
    what_they_sell: z
      .enum(["apparel", "home_textiles", "fabric", "yarn", "accessories", "other"])
      .nullable()
      .optional(),
    price_range: z
      .enum(["economy", "mid", "premium", "luxury"])
      .nullable()
      .optional(),
    has_inventory_info: z.boolean().nullable().optional(),
    does_stock: z.boolean().nullable().optional(),
    does_weaving: z.boolean().nullable().optional(),
    person_type: z
      .enum([
        "individual",
        "business",
        "manufacturer",
        "wholesaler",
        "retailer",
        "artisan",
        "other",
      ])
      .nullable()
      .optional(),
    team_size: z.number().int().min(0).max(100000).nullable().optional(),
    payment_collection: z
      .enum(["through_us", "themselves"])
      .nullable()
      .optional(),
    completed: z.boolean().optional(),
  })
  .strict()

export type OnboardingProfileUpdateInput = z.infer<
  typeof onboardingProfileUpdateSchema
>
