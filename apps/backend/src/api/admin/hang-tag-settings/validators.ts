import { z } from "@medusajs/framework/zod"

/**
 * Hang tag config fields a brand profile may set (#2541). Loose on purpose for
 * the layout/canvas blobs the settings editor already writes; strict on the
 * fields this issue adds, since they reach printed text.
 */
const brandConfigSchema = z
  .object({
    brand_name: z.string().trim().min(1).max(80).optional(),
    logo_url: z.string().url().nullable().optional(),
    tagline: z.string().max(120).optional(),
    care_text: z.string().max(600).optional(),
    mrp_label: z.string().max(20).optional(),
    mrp_note: z.string().max(60).optional(),
    show_story: z.boolean().optional(),
    show_care: z.boolean().optional(),
    show_mrp: z.boolean().optional(),
  })
  .passthrough()

export const createHangTagBrandSchema = z.object({
  config: brandConfigSchema.extend({ brand_name: z.string().trim().min(1).max(80) }),
})

export const updateHangTagBrandSchema = z.object({
  config: brandConfigSchema,
})

export type CreateHangTagBrand = z.infer<typeof createHangTagBrandSchema>
export type UpdateHangTagBrand = z.infer<typeof updateHangTagBrandSchema>
