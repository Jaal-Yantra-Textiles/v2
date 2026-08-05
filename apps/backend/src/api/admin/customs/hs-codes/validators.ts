import { z } from "@medusajs/framework/zod"

/**
 * Bulk HS/HSN code assignment.
 *
 * `hs_code` is deliberately a plain non-empty string rather than a strict
 * 6-10 digit pattern: HS is 6 digits internationally but nations extend it
 * (India's HSN runs to 8, some tariff lines to 10) and carriers accept the
 * extended forms. Over-validating here would reject legitimate codes at the
 * one place a merchant can enter them in bulk.
 */
export const HsCodeAssignmentSchema = z.object({
  level: z.enum(["variant", "inventory_item", "product"]),
  id: z.string().min(1),
  hs_code: z.string().min(1),
  origin_country: z.string().optional(),
  material: z.string().optional(),
})

export const BulkHsCodesSchema = z.object({
  // Capped so one call can't walk the whole catalogue in a single request —
  // each row is a separate workflow run, and a runaway batch would hold a
  // connection open long past any sane request timeout.
  assignments: z.array(HsCodeAssignmentSchema).min(1).max(200),
})

export type BulkHsCodesReq = z.infer<typeof BulkHsCodesSchema>
