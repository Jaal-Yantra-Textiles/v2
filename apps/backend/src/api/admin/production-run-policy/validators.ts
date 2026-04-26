import { z } from "@medusajs/framework/zod"

export const AdminUpdateProductionRunPolicySchema = z.object({
  config: z.record(z.any()).nullable(),
})

export type AdminUpdateProductionRunPolicyReq = z.infer<
  typeof AdminUpdateProductionRunPolicySchema
>
