import { z } from "@medusajs/framework/zod"

export const setPersonSubscriptionSchema = z.object({
  subscribed: z.boolean(),
})

export type SetPersonSubscriptionBody = z.infer<typeof setPersonSubscriptionSchema>
