import { z } from "@medusajs/framework/zod"

export const splitInventorySchema = z.object({
  quantity: z.number().int().positive(),
  new_title: z.string().min(1),
  /** When set, split is taken from this specific location only (not proportional). */
  location_id: z.string().optional(),
  raw_material_overrides: z
    .object({
      name: z.string().optional(),
      color: z.string().optional(),
      composition: z.string().optional(),
      grade: z.string().optional(),
      description: z.string().optional(),
      extra: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})
