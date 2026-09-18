import { z } from "@medusajs/framework/zod"

/**
 * Partner-side schemas for PROPOSING changes to an inventory order (#1752).
 *
 * A partner stages edits, removals and `tax` — never applies them. So these are
 * deliberately narrower than the admin order-lines update:
 *   - every line entry MUST carry an `id` (a partner edits/removes existing
 *     lines; they cannot add new goods lines or name arbitrary items);
 *   - the only charge type a partner may propose is `tax` (a partner must not
 *     write a discount/adjustment that lowers what they are owed, and shipping
 *     is the shipment flow's business).
 */

export const partnerUpdateOrderLinesSchema = z.object({
  data: z
    .object({
      quantity: z.number().optional(),
      total_price: z.number().optional(),
    })
    .optional(),
  order_lines: z
    .array(
      z
        .object({
          id: z.string().min(1, "A line entry must reference the existing line id"),
          quantity: z.number().optional(),
          price: z.number().optional(),
          extra_cost: z.number().nonnegative().optional(),
          remove: z.boolean().optional(),
        })
        .superRefine((val, ctx) => {
          if (val.remove) return
          if (val.quantity == null || val.quantity < 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["quantity"],
              message: "Quantity must be at least 1",
            })
          }
          if (val.price == null || val.price < 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["price"],
              message: "Price must be non-negative",
            })
          }
        })
    )
    .min(1, "At least one order line is required"),
})

export type PartnerUpdateOrderLines = z.infer<typeof partnerUpdateOrderLinesSchema>

export const partnerAddOrderChargeSchema = z.object({
  type: z.literal("tax", {
    error: "A partner may only propose a 'tax' charge",
  }),
  amount: z.number().positive("A charge amount must be positive"),
  note: z.string().min(1).optional(),
})

export type PartnerAddOrderCharge = z.infer<typeof partnerAddOrderChargeSchema>