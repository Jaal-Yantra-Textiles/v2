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
    /**
     * Payout lines sourced from INVENTORY ORDERS — material we bought from this
     * partner (#1710).
     *
     * 🔴 Until this existed a partner could bill only for WORK. The goods half
     * of what they are owed had no partner-facing expression at all: the admin
     * route has accepted `inventory_order_lines` since #1612, this one accepted
     * `design_ids` and `task_ids` and nothing else, and no partner screen
     * listed an order. The only self-serve path left was
     * `POST /partners/inventory-orders/:id/submit-payment`, which records an
     * `internal_payments` row that is NOT a claim and that no payout accounts
     * for — the two orphaned INR 10,000 rows behind #1710.
     *
     * ⚠️ `amount` is an OVERRIDE, and the same one the admin route documents:
     * left absent the workflow derives what is owed from the typed
     * `line_fulfillments` receipts, because `total_price` is what was ORDERED.
     * One `Partial` order is ordered at INR 88,885 with INR 25,670 received.
     *
     * ⚠️ Deliberately NOT accepting a `partner_id` anywhere on this schema. The
     * route takes it from the auth context, and the workflow re-checks that
     * every order named here belongs to that partner — both ends, because a
     * request that names an id must be validated at both (#778).
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
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine(
    (data) =>
      (data.design_ids?.length || 0) +
        (data.task_ids?.length || 0) +
        (data.inventory_order_lines?.length || 0) >
      0,
    {
      message: "At least one design, task or inventory order is required",
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

/**
 * A partner turning their own Draft into a real claim (#1604).
 *
 * ⚠️ No `status` here either, for the same reason `CreatePaymentSubmissionSchema`
 * refuses it: the route decides where a submission lands, not the caller.
 */
export const SubmitPaymentSubmissionSchema = z.object({
  notes: z.string().optional(),
})
