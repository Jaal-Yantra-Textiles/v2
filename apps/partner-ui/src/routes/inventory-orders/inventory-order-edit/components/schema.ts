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
    const qty = castNumber(val.quantity)
    if (!Number.isFinite(qty) || qty < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Quantity must be at least 1",
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

export type EditInventoryOrderLinesSchemaType = z.infer<
  typeof EditInventoryOrderLinesSchema
>