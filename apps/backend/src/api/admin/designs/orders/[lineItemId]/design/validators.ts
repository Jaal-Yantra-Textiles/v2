import { z } from "zod"

/**
 * #1918 — re-point an order item's design.
 *
 * `design_id` is `.nullable()` but NOT `.optional()`: an explicit null is the
 * detach instruction, and omitting the field entirely is rejected by the route.
 * Those must stay distinguishable — treating a forgotten field as a detach
 * would silently unlink a garment somebody paid for.
 */
export const ChangeOrderItemDesignSchema = z.object({
  design_id: z.string().trim().min(1).nullable(),
  /** Skip the customer email — for a correction they should not see. */
  notify: z.boolean().optional(),
  /** Preview the change and the email without performing either. */
  dry_run: z.boolean().optional(),
})

export type ChangeOrderItemDesign = z.infer<typeof ChangeOrderItemDesignSchema>
