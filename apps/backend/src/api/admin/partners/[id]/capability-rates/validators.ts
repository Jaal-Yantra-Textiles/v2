import { z } from "@medusajs/framework/zod"

import { RATE_UNITS, TECHNIQUE_SLUGS } from "../../../../../modules/partner_capability/lib/techniques"

/** #2596 — a partner's rate estimate for one technique. `partner_id` comes from the URL. */
const rateFields = {
  technique: z.enum(TECHNIQUE_SLUGS),
  sample_id: z.string().min(1).nullable().optional(),
  unit: z.enum(RATE_UNITS).optional(),
  min_qty: z.number().int().positive().nullable().optional(),
  max_qty: z.number().int().positive().nullable().optional(),
  currency_code: z.string().length(3).toLowerCase().optional(),
  price_low: z.number().nonnegative(),
  price_high: z.number().nonnegative().nullable().optional(),
  setup_fee: z.number().nonnegative().nullable().optional(),
  lead_days: z.number().int().nonnegative().nullable().optional(),
  tax_basis: z.enum(["gst_exclusive", "gst_inclusive", "unknown"]).optional(),
  source: z.enum(["partner_quoted", "admin_estimate", "from_past_runs"]).optional(),
  status: z.enum(["proposed", "confirmed"]).optional(),
  observed_at: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
}

export const AdminCreateCapabilityRateReq = z.object(rateFields)
export type AdminCreateCapabilityRateReq = z.infer<typeof AdminCreateCapabilityRateReq>

export const AdminUpdateCapabilityRateReq = z
  .object(rateFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update")
export type AdminUpdateCapabilityRateReq = z.infer<typeof AdminUpdateCapabilityRateReq>

export const AdminListCapabilityRatesQuery = z.object({
  technique: z.string().optional(),
})
export type AdminListCapabilityRatesQuery = z.infer<typeof AdminListCapabilityRatesQuery>
