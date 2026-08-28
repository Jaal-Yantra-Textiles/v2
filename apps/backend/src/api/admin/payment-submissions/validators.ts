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
  /**
   * Free-text search over the submission id.
   *
   * 🔴 The list screen has always rendered a search box, and nothing ever sent
   * its value anywhere — a control that looks like it filters and does not is
   * worse than no control, because an unchanged list reads as "no other
   * results" (#1622). The box is now honoured.
   *
   * ⚠️ `zodValidator` forces `.strict()`, so a param that is not declared here
   * is a 400 rather than an ignored extra. Declaring it is what makes the UI
   * able to send it at all.
   */
  q: z.string().trim().min(1).optional(),
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
     * What the payout is denominated in. Absent means the partner's own
     * currency, then `inr` — see `lib/submission-currency`, which owns that
     * precedence so two routes cannot disagree about it.
     */
    currency: z.string().min(1).optional(),
    /**
     * Payout lines sourced from production RUNS (#1612).
     *
     * 🔑 The only expression available for a run with `design_id: null` — one
     * minted from `order.fulfillment_created` is not design-backed and never
     * will be, so no `design_ids` entry can reach it.
     *
     * Grouping is deliberate: the seven runs behind order #79 are ONE payout of
     * ₹8,974, not seven of ₹1,282, because that is how the money moved.
     */
    run_lines: z
      .array(
        z.object({
          run_ids: z.array(z.string().min(1)).min(1),
          amount: z.coerce.number().positive().optional(),
          quantity: z.coerce.number().positive().optional(),
          order_id: z.string().min(1).optional(),
          label: z.string().optional(),
          currency: z.string().min(1).optional(),
        })
      )
      .optional(),
    /**
     * Payout lines sourced from INVENTORY ORDERS — material bought from the
     * partner.
     *
     * ⚠️ `amount` is an OVERRIDE. Left absent, the workflow derives what is
     * owed from the typed `line_fulfillments` receipts, because `total_price`
     * is what was ordered: one `Partial` order is ordered at ₹88,885 with
     * ₹25,670 actually received.
     */
    inventory_order_lines: z
      .array(
        z.object({
          inventory_order_id: z.string().min(1),
          amount: z.coerce.number().positive().optional(),
          currency: z.string().min(1).optional(),
        })
      )
      .optional(),
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
    (data) =>
      (data.design_ids?.length || 0) +
        (data.task_ids?.length || 0) +
        (data.run_lines?.length || 0) +
        (data.inventory_order_lines?.length || 0) >
      0,
    {
      message:
        "At least one design, task, production run or inventory order is required",
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

/**
 * Correcting a submission's own DESCRIPTION (#1611).
 *
 * 🔴 `notes` and nothing else. The money on a submission is the sum of its
 * lines, and every path that touches a line re-runs the double-pay claim
 * guards; a route that could set `total_amount` or `status` here would be a
 * clean bypass of all of them. An amount is corrected through
 * `PATCH /:id/items/:itemId`, which is guarded — this route exists only so the
 * SENTENCE describing a payout can be made to match it.
 *
 * ⚠️ Allowed at ANY status, deliberately. Submission 01M0Y336X9… reads
 * "Billed 7 x 1200 = 8400" against a line that was corrected to ₹10,000, and
 * that record is more wrong today than it was when it was written. The same
 * reasoning as #1621's documents-at-any-status: a payout's paperwork arrives
 * after the money moves, and refusing the correction preserves the error.
 */
export const UpdatePaymentSubmissionSchema = z.object({
  /** `""` clears the note. Distinct from omitting it, which changes nothing. */
  notes: z.string(),
})
