import { z } from "@medusajs/framework/zod"

/**
 * #2286 — what the receiving partner states arrived.
 *
 * `lines` is required and non-empty: unlike the admin door, a partner receipt
 * exists to record THEIR count. Quantity 0 is allowed ("this line brought
 * nothing"). There is no location field: goods land at the partner's own
 * warehouse.
 */
export const partnerReceiveIncomingSchema = z.object({
  lines: z
    .array(
      z.object({
        order_line_id: z.string().min(1),
        quantity: z.number().nonnegative(),
      })
    )
    .min(1),
  notes: z.string().max(2000).optional(),
})

export type PartnerReceiveIncomingReq = z.infer<typeof partnerReceiveIncomingSchema>
