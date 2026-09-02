import { z } from "@medusajs/framework/zod"

/**
 * ⚠️ `zodValidator` forces `.strict()`, so an unlisted field is a 400 rather
 * than a silent drop. Wanted here for the same reason as the create schema: a
 * typo'd field on a money write that vanished quietly is how `metadata` blobs
 * ended up deciding payouts (#1557).
 */
export const ApplyPartnerCreditSchema = z.object({
  /**
   * The payout this credit discharges. Required — a credit applied to "the
   * partner" in general reduces nothing and stamps a decision nobody can audit.
   */
  submission_id: z.string().min(1, "submission_id is required"),
})

export type ApplyPartnerCredit = z.infer<typeof ApplyPartnerCreditSchema>
