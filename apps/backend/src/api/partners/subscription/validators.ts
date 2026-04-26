import { z } from "@medusajs/framework/zod"

export const subscribeSchema = z.object({
  plan_id: z.string().min(1),
})
