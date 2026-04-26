import { z } from "@medusajs/framework/zod"

export const AccessFeeConfirmSchema = z.object({
  session_id: z.string(),
})

export type AccessFeeConfirmReq = z.infer<typeof AccessFeeConfirmSchema>
