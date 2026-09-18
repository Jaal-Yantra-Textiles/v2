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
        /**
         * Where THIS portion lands (#2144). Omit and it follows the order's
         * destination. Repeat the same `order_line_id` with different locations
         * to SPLIT one delivery: the partner keeps what they will cut, the
         * balance goes to our warehouse. The planner sums the portions per line,
         * so splitting cannot be used to receive the same goods twice.
         */
        stock_location_id: z.string().min(1).optional(),
      })
    )
    .optional(),
  /** Override the order's own destination. Rarely needed; goods go where the order says. */
  stock_location_id: z.string().min(1).optional(),
  notes: z.string().optional(),
})

export type ReceiveInventoryOrderReq = z.infer<typeof receiveInventoryOrderSchema>
