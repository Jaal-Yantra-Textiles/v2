import { z } from "@medusajs/framework/zod"

/**
 * ⚠️ `zodValidator` forces `.strict()`, so an unlisted field is a 400 rather
 * than silently dropped. That is the behaviour we want here: a credit is money,
 * and a typo'd field name that vanished quietly is how `metadata` blobs ended
 * up deciding payouts (#1557).
 */
export const CreatePartnerCreditSchema = z.object({
  amount: z.coerce.number().positive(),
  currency_code: z.string().min(1).optional(),
  source_type: z.enum(["overpayment", "adjustment", "goodwill"]).optional(),
  /** Required — see the route and the model for why it is never defaulted. */
  reason: z.string().min(1, "reason is required"),
  source_submission_id: z.string().min(1).optional(),
  /** Earmark the credit against an order. Optional by design. */
  inventory_order_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.any()).nullish(),
})

export type CreatePartnerCredit = z.infer<typeof CreatePartnerCreditSchema>
