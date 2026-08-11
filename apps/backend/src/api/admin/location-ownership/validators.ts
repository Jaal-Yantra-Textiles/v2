import { z } from "@medusajs/framework/zod"

export const AdminPostLocationOwnershipReq = z.object({
  stock_location_id: z.string().min(1),
  is_core: z.boolean(),
  note: z.string().nullable().optional(),
})

export type AdminPostLocationOwnershipReq = z.infer<
  typeof AdminPostLocationOwnershipReq
>
