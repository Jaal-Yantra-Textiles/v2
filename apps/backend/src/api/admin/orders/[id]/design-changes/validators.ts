import { z } from "zod"

/**
 * #1918 — change the designs on an order, as ONE change.
 *
 * The shape mirrors Medusa's own order edit: a list of actions applied
 * together, producing one notification, rather than a call (and an email) per
 * line.
 *
 * `design_id` is `.nullable()` but NOT `.optional()` on each entry, for the
 * same reason as the single-line route: an explicit null is the detach
 * instruction, and a forgotten field must never read as one.
 */
export const ChangeOrderDesignsSchema = z.object({
  changes: z
    .array(
      z.object({
        line_item_id: z.string().trim().min(1),
        design_id: z.string().trim().min(1).nullable(),
      })
    )
    .min(1, "Send at least one line to change."),
  /**
   * What production should do (#1953). `mode: "new"` commissions a run for
   * every line this change actually moves — the only way to bind work to a
   * line without guessing whose work it is.
   */
  production: z
    .object({
      mode: z.enum(["none", "new"]).optional(),
      quantity: z.number().nullable().optional(),
      partner_id: z.string().trim().min(1).nullable().optional(),
    })
    .optional(),
  /** Skip the customer email — for a correction they should not see. */
  notify: z.boolean().optional(),
  /** Preview the change and the email without performing either. */
  dry_run: z.boolean().optional(),
})

export type ChangeOrderDesigns = z.infer<typeof ChangeOrderDesignsSchema>
