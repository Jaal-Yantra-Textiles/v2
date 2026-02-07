import { z } from "@medusajs/framework/zod"

export const AllocateItemsSchema = z.object({
  location_id: z.string(),
  quantity: z.record(z.string(), z.number().or(z.string())),
})
