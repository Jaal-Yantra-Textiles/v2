import { z } from "@medusajs/framework/zod"

export const splitInventorySchema = z.object({
  quantity: z.number().int().positive(),
  new_title: z.string().min(1),
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
