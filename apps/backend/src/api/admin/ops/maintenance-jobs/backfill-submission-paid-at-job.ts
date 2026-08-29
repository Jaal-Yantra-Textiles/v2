import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PAYMENT_REPORTS_MODULE } from "../../../../modules/payment_reports"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — stamp `paid_at` on payouts settled BEFORE the column existed
 * (#1639).
 *
 * `payment_submission.paid_at` was added by #1638 and is written from #1639
 * onward by settling the reconciliation. The payouts already settled have a
 * real settlement timestamp — `payment_reconciliation.settled_at` — but a null
 * `paid_at`, so they read "paid, time unknown" beside every future payout that
 * carries one.
 *
 * ⚠️ It records something that ALREADY HAPPENED. It changes no status, no
 * amount, and no partner. It copies one timestamp that already exists onto the
 * row that should have carried it.
 *
 * ## It transcribes; it does not deduce
 *
 * 🔴 `paid_at` is taken from the reconciliation's `settled_at` and from nowhere
 * else. Not `updated_at`, not `reviewed_at`, not the payment's `payment_date` —
 * those record when someone approved or when a row was touched, and writing one
 * of them into a field that means "when money moved" would manufacture a fact.
 * On production the approval→settlement gap ran from 13 seconds to 34 days, so
 * the two are demonstrably not interchangeable.
 *
 * A submission whose reconciliation is not `Settled`, or which has no
 * reconciliation at all, is SKIPPED. There is no evidence of when its money
 * moved, and a null `paid_at` says exactly that. Guessing would be worse than
 * the gap: an absent timestamp is visibly absent, a wrong one reads as fact.
 *
 * 🔑 No STATUS backfill is needed and none is performed. Probed on production
 * 2026-08-29: the 5 `Paid` submissions are exactly the 5 settled
 * reconciliations, id for id, and no submission sits in `Approved`. The new
 * meaning of `Paid` — settled, not merely authorised — is already true of every
 * existing row, which is why this job only fills in the timestamp.
 *
 * Idempotent: a submission that already has a `paid_at` is left alone, so it is
 * safe to re-run.
 */
const paramsSchema = z.object({
  /** One submission, for a spot check before a full pass. */
  payment_submission_id: z.string().min(1).optional(),
  /** Bound a first pass; omitted means every payout that needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export const backfillSubmissionPaidAtJob: MaintenanceJob = {
  id: "backfill-submission-paid-at",
  label: "Stamp paid_at on payouts settled before the column existed",
  description:
    "Copy payment_reconciliation.settled_at onto payment_submission.paid_at for payouts settled before #1638 added the column. Records something that already happened: changes no status, no amount, no partner, and moves no money. The timestamp is read from the reconciliation's settled_at and from nowhere else — never updated_at, reviewed_at, or a payment's payment_date, which record when someone approved rather than when money moved; on production that gap ran from 13 seconds to 34 days, so they are demonstrably not interchangeable. A submission whose reconciliation is not Settled, or which has none, is skipped rather than guessed: a null paid_at truthfully says the time is unknown, while a wrong one reads as fact. No status backfill is performed and none is needed — probed 2026-08-29, the 5 Paid submissions are exactly the 5 settled reconciliations, id for id, and nothing sits in Approved. Idempotent: a submission that already carries a paid_at is left alone, so it is safe to re-run.",
  params: [
    {
      name: "payment_submission_id",
      type: "string",
      required: false,
      description: "Only this submission, e.g. for a spot check before a full pass.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many stamps. Omit for every one that is missing.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }

    const submissionService: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const reportsService: any = container.resolve(PAYMENT_REPORTS_MODULE)

    /**
     * Driven from the RECONCILIATIONS, not from the submissions.
     *
     * The evidence is the settlement record; a submission is only a candidate
     * because one names it. Starting from submissions would invite filling in
     * the ones with no evidence.
     */
    const reconciliations = (await reportsService.listPaymentReconciliations({
      reference_type: "payment_submission",
      status: "Settled",
    })) as any[]

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    /** Settled, but the reconciliation itself carries no `settled_at`. */
    const noTimestamp: string[] = []
    let alreadyStamped = 0
    let missingSubmission = 0

    const limit = parsed.data.limit ?? Number.POSITIVE_INFINITY

    for (const recon of reconciliations || []) {
      if (changes.length >= limit) break

      const submissionId = recon?.reference_id ? String(recon.reference_id) : ""
      if (!submissionId) continue
      if (
        parsed.data.payment_submission_id &&
        submissionId !== parsed.data.payment_submission_id
      ) {
        continue
      }

      const settledAt = recon?.settled_at
      if (!settledAt) {
        // Settled with no timestamp — report it, never substitute another date.
        noTimestamp.push(submissionId)
        continue
      }

      let submission: any
      try {
        const rows = await submissionService.listPaymentSubmissions({
          id: [submissionId],
        })
        submission = (rows as any[])?.[0]
      } catch (e: any) {
        errors.push({ id: submissionId, message: e?.message || "lookup failed" })
        continue
      }

      if (!submission) {
        missingSubmission++
        continue
      }
      if (submission.paid_at) {
        alreadyStamped++
        continue
      }

      changes.push({
        entity: "payment_submission",
        id: submissionId,
        field: "paid_at",
        before: null,
        after: settledAt,
        note:
          `reconciliation ${recon.id} is Settled with settled_at=${new Date(
            settledAt
          ).toISOString()}` +
          ` (submission status ${submission.status}, settled_by ${recon.settled_by ?? "unknown"})`,
      })

      if (!dry_run) {
        try {
          await submissionService.updatePaymentSubmissions({
            id: submissionId,
            paid_at: settledAt,
          })
        } catch (e: any) {
          errors.push({ id: submissionId, message: e?.message || "update failed" })
        }
      }
    }

    if (
      parsed.data.payment_submission_id &&
      !changes.length &&
      !alreadyStamped &&
      !noTimestamp.length
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission ${parsed.data.payment_submission_id} has no settled reconciliation, so there is no evidence of when it was paid`
      )
    }

    const bits = [
      `${changes.length} payout${changes.length === 1 ? "" : "s"} ${
        dry_run ? "would be" : "were"
      } stamped with paid_at`,
      `${alreadyStamped} already carried one`,
    ]
    if (noTimestamp.length) {
      bits.push(
        `${noTimestamp.length} settled WITHOUT a settled_at and were skipped rather than dated from another field (${noTimestamp.join(", ")})`
      )
    }
    if (missingSubmission) {
      bits.push(`${missingSubmission} named a submission that no longer exists`)
    }
    if (errors.length) {
      bits.push(`${errors.length} failed`)
    }

    return {
      job_id: "backfill-submission-paid-at",
      dry_run,
      applied: !dry_run && changes.length > 0 && errors.length < changes.length,
      summary: bits.join("; "),
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
