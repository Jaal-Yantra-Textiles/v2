import { z } from "zod"

import { paymentSubmissionMoneyFields } from "../../../workflows/payment_submissions/lib/money-fields"

/**
 * Partners can bundle any combination of designs and tasks into a single
 * submission. At least one item (from either list) is required.
 */
export const CreatePaymentSubmissionSchema = z
  .object({
    design_ids: z.array(z.string().min(1)).optional().default([]),
    task_ids: z.array(z.string().min(1)).optional().default([]),
    notes: z.string().optional(),
    documents: z
      .array(
        z.object({
          id: z.string().optional(),
          url: z.string(),
          filename: z.string().optional(),
          mimeType: z.string().optional(),
        })
      )
      .optional(),
    /**
     * The money contract as real fields. Same fragment the admin route uses —
     * one owner, so the two surfaces cannot drift apart on what decides a
     * payout. See `paymentSubmissionMoneyFields`.
     *
     * ⚠️ Deliberately NOT accepting `status` or `require_design_status` here.
     * A partner may not choose which review state their own claim lands in, and
     * may not waive the design-eligibility gate on it.
     */
    ...paymentSubmissionMoneyFields,
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine(
    (data) => (data.design_ids?.length || 0) + (data.task_ids?.length || 0) > 0,
    {
      message: "At least one design or task is required",
      path: ["design_ids"],
    }
  )

export const ListPaymentSubmissionsQuerySchema = z.object({
  status: z
    .enum([
      "Draft",
      "Pending",
      "Under_Review",
      "Approved",
      "Rejected",
      "Paid",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
})
