import { z } from "@medusajs/framework/zod"

export const AdminPostLocationOwnershipReq = z.object({
  stock_location_id: z.string().min(1),
  is_core: z.boolean(),
  /**
   * Whether an export may LEAVE from here (#1498).
   *
   * 🔑 OPTIONAL, and `null` is a real value distinct from omitting it. Omitted
   * leaves whatever is stored alone; `null` clears the answer back to "nobody
   * has decided", which puts this row back under the `is_core` inference. A
   * caller that always sent `false` by default would silently switch the whole
   * platform off the inference on the first unrelated ownership edit.
   */
  is_export_origin: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
})

export type AdminPostLocationOwnershipReq = z.infer<
  typeof AdminPostLocationOwnershipReq
>
