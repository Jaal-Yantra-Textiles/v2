import { z } from "zod"

import { paymentSubmissionMoneyFields } from "../../../workflows/payment_submissions/lib/money-fields"

export const AdminListPaymentSubmissionsQuerySchema = z.object({
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
  partner_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
})

/**
 * The payable-runs lookup. `partner_id` is required rather than optional-with-
 * a-default: this endpoint answers "what can I pay THIS partner for", and a
 * missing filter would return every completed run on the platform — the shape
 * that made one dangling key return unfiltered cross-tenant rows (#1397).
 */
export const AdminPayableRunsQuerySchema = z.object({
  partner_id: z.string().min(1, "partner_id is required"),
})

export const AdminReviewPaymentSubmissionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejection_reason: z.string().optional(),
  amount_override: z.number().optional(),
  payment_type: z
    .enum(["Bank", "Cash", "Digital_Wallet"])
    .optional()
    .default("Bank"),
  paid_to_id: z.string().optional(),
  notes: z.string().optional(),
})

/**
 * Admin-initiated submission creation. Same shape as the partner schema
 * plus an explicit partner_id the admin is submitting on behalf of.
 * Requires at least one design or task.
 */
export const CreateAdminPaymentSubmissionSchema = z
  .object({
    partner_id: z.string().min(1, "partner_id is required"),
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
     * The money contract — quantities, per-unit rates and typed totals — as
     * real fields rather than untyped `metadata` keys. Shared with the partner
     * route so the two cannot drift. See `paymentSubmissionMoneyFields`.
     */
    ...paymentSubmissionMoneyFields,
    /**
     * Where the submission lands. The workflow has always accepted this; the
     * route never forwarded it, so an admin-created submission could only ever
     * be "Pending" — never the Draft an admin actually wants when preparing a
     * payout for review.
     */
    status: z.enum(["Draft", "Pending"]).optional(),
    /**
     * Skip the design-status gate (must be Approved/Commerce_Ready).
     *
     * The run-completion auto-draft already passes `false` because its proof of
     * finished work is the COMPLETED RUN, not the design's review state. An
     * admin paying out a finished run is in exactly that position, and without
     * this the only way through was to edit the design's status — changing what
     * the record asserts about technical review in order to release a payment.
     */
    require_design_status: z.boolean().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine(
    (data) => (data.design_ids?.length || 0) + (data.task_ids?.length || 0) > 0,
    {
      message: "At least one design or task is required",
      path: ["design_ids"],
    }
  )

/**
 * Draft → Pending, in place (#1604). Nothing but an optional note: the money,
 * the designs and the runs are already on the draft, and a second way to state
 * them here is a second way for them to disagree.
 */
export const SubmitPaymentSubmissionSchema = z.object({
  notes: z.string().optional(),
})

/**
 * Correcting one line (#1604).
 *
 * Every field optional, and an absent field keeps its current value — a PATCH
 * that silently reset the rate would be a worse defect than the one this route
 * exists to fix. At least one must be present, so an empty body is an error
 * rather than a write of nothing that returns 200.
 *
 * 🔴 `production_run_ids` re-runs the full claim guard in the workflow. It is
 * the column that decides whether the same work can be billed twice, and an
 * edit route that wrote it unguarded would silently undo #1602.
 */
export const UpdatePaymentSubmissionItemSchema = z
  .object({
    quantity: z.coerce.number().positive("quantity must be greater than 0").optional(),
    unit_amount: z.coerce
      .number()
      .positive("unit_amount must be greater than 0")
      .optional(),
    amount: z.coerce.number().positive("amount must be greater than 0").optional(),
    /** `[]` is meaningful: it says this line names no runs. */
    production_run_ids: z.array(z.string().min(1)).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine(
    (data) =>
      data.quantity !== undefined ||
      data.unit_amount !== undefined ||
      data.amount !== undefined ||
      data.production_run_ids !== undefined ||
      data.metadata !== undefined,
    { message: "Nothing to update" }
  )
