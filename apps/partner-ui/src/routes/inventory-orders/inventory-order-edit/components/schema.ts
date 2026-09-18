import { z } from "@medusajs/framework/zod"

import { castNumber } from "../../../../lib/cast-number"

/**
 * #1752 — the partner proposes line edits + a tax charge on an assigned
 * inventory order. Nothing is applied: this form only stages a draft for an
 * admin to approve post-ship. So the shape is deliberately narrow — every line
 * carries its existing id (a partner edits/removes, never adds), and the only
 * extra is a tax PERCENT, which this UI turns into a flat amount on submit.
 *
 * The DataGrid number/currency cells write strings into the form, so numeric
 * fields are `z.union([number, string])` and coerced with `castNumber` at
 * submit — matching `inventory-stock/schema.ts`.
 */

export type OrderLineRow = {
  id: string
  title: string
  sku?: string | null
  quantity: number
  price: number
  extra_cost: number
  remove: boolean
}

const orderLineSchema = z
  .object({
    id: z.string(),
    quantity: z.union([z.number(), z.string()]),
    price: z.union([z.number(), z.string()]),
    extra_cost: z.union([z.number(), z.string()]),
    remove: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.remove) {
      return
    }
    /**
     * 🔑 GREATER THAN ZERO, not "at least 1". These lines are cloth, yarn and
     * trim — metres and kilograms, not pieces — and the column behind them is
     * a Postgres `real`. The floor of 1 was ours, and it refused 12.5 m on a
     * column built to hold it. Mirrors the backend rule in `change-schemas.ts`;
     * a UI that permits less than the route does is a field the partner cannot
     * reach, and one that permits more is a 400 they cannot predict.
     *
     * 0 stays refused: an emptied line is a REMOVAL, and the remove column is
     * how that is said.
     */
    const qty = castNumber(val.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Quantity must be greater than 0 — tick Remove to take the line off",
      })
    }
    const price = castNumber(val.price)
    if (!Number.isFinite(price) || price < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Price must be non-negative",
      })
    }
  })

export const EditInventoryOrderLinesSchema = z.object({
  order_lines: z.array(orderLineSchema).min(1, "At least one order line is required"),
  /**
   * 🔴 BOUNDED, 0–100. Unbounded, a negative percent rendered a reduced total in
   * the footer and then proposed nothing at all — the submit guard dropped a
   * non-positive tax silently, so the partner believed they had proposed a
   * figure the admin never saw. A screen must not show a total it will not send.
   *
   * 0 is valid and means "no tax": it WITHDRAWS a tax proposed earlier, which
   * is the only way to take one back.
   */
  tax_percent: z
    .union([z.number(), z.string()])
    .superRefine((val, ctx) => {
      const n = castNumber(val ?? "")
      if (val === "" || val == null) {
        return
      }
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tax percent must be a number" })
        return
      }
      if (n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tax percent cannot be negative" })
      }
      if (n > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tax percent cannot exceed 100" })
      }
    }),
})
  /**
   * 🔴 At least one line must SURVIVE — `.min(1)` above counts rows, not
   * survivors, so it passes a form with every row ticked for removal.
   *
   * Refused here as well as at the route, because this is the end where the
   * person can still see what they meant. The backend refuses it too
   * (`removesEveryLine`): a client-side rule is a courtesy, never the guard.
   *
   * Removing SOME lines stays ordinary — a bolt that never arrived, a colour
   * that was cancelled. Removing all of them is a cancellation of the order,
   * which is a different decision with a different owner.
   */
  .superRefine((val, ctx) => {
    const rows = val.order_lines ?? []
    if (rows.length > 0 && rows.every((l) => l.remove)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["order_lines"],
        message:
          "This removes every line, which would leave the order empty. Keep at least one line, or ask for the order to be cancelled.",
      })
    }
  })

export type EditInventoryOrderLinesSchemaType = z.infer<
  typeof EditInventoryOrderLinesSchema
>