import { z } from "@medusajs/framework/zod"

/**
 * #2115 — recording that goods turned up.
 *
 * Everything is optional on purpose. The common case is an order the carrier
 * already delivered in full, and making the operator retype every line to say
 * "yes, it all arrived" is how a receipt step ends up never being used. Omit
 * `lines` and the workflow receives whatever is still outstanding.
 */
export const receiveInventoryOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        order_line_id: z.string().min(1),
        // `.nonnegative()` rather than `.positive()`: 0 is a legitimate way to
        // say "this line brought nothing", and the planner drops it.
        quantity: z.number().nonnegative(),
      })
    )
    .optional(),
  /** Override the order's own destination. Rarely needed; goods go where the order says. */
  stock_location_id: z.string().min(1).optional(),
  notes: z.string().optional(),
})

export type ReceiveInventoryOrderReq = z.infer<typeof receiveInventoryOrderSchema>
