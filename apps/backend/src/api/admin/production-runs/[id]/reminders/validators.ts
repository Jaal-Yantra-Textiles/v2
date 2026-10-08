import { z } from "@medusajs/framework/zod"

export const ProductionRunRemindersSchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})

export type ProductionRunRemindersBody = z.infer<typeof ProductionRunRemindersSchema>
