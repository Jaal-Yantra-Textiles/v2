import { z } from "@medusajs/framework/zod"

export const sendOrderRefundEmailSchema = z.object({
  /** The refunded amount in major units. Defaults to the order's latest refund. */
  amount: z.number().positive().optional(),
  /** The admin's explanation, shown to the buyer in the email. */
  note: z.string().trim().max(2000).optional(),
  /** Render the email and return it without sending (HTTP callers). */
  dry_run: z.boolean().optional(),
  /**
   * Same as dry_run. The MCP dispatcher intercepts `dry_run` and never calls
   * the route, so the tool advertises `preview`, the passthrough twin.
   */
  preview: z.boolean().optional(),
  /** Must be true to send: an email cannot be recalled. */
  confirm: z.boolean().optional(),
})

export type SendOrderRefundEmailBody = z.infer<typeof sendOrderRefundEmailSchema>
