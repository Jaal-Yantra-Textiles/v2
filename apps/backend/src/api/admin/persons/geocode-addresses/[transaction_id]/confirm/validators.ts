import { z } from "@medusajs/framework/zod"

export const ConfirmBody = z.object({
  workflow_id: z.string(),
  step_id: z.string(),
})

export type ConfirmBody = z.infer<typeof ConfirmBody>