import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import {
  runPayableAmount,
  runUnitCost,
  type RunForPayout,
} from "../../../../workflows/production-runs/lib/run-payable"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Find payment submission lines that billed ONE piece for a multi-piece run.
 *
 * ## What went wrong
 *
 * `design.estimated_cost` / `production_cost` are PER FINISHED UNIT —
 * `workflows/designs/estimate-design-cost.ts` divides a run total back to
 * per-unit for exactly that reason, and its own input docs say so. But
 * `create-payment-submission` used that figure as the entire line amount and
 * had no concept of quantity at all: grep the pre-#1554 file for `quantity`
 * and there is nothing, and `payment_submission_item` had `amount` and no
 * quantity column. A design costed at 850/unit and produced nine times billed
 * **850**.
 *
 * Only the run-completion auto-draft escaped it, by passing an
 * already-multiplied total through `design_cost_overrides` — and only when
 * `cost_type` actually said `per_unit`, which the partner UI's `"total"`
 * default quietly prevented.
 *
 * Fixed forward in #1554. This is for the rows already written.
 *
 * ## 🔴 Why it does not fix anything by default
 *
 * The direction of this defect is **under-payment of an artisan**. That makes
 * the correction a payment decision, not a data repair:
 *
 *  - On a **Paid** or **Approved** submission the money has moved or been
 *    committed. Editing the row would make our record disagree with what was
 *    actually paid, and would not put a rupee in anyone's hand. Those are
 *    ALWAYS report-only, whatever the parameters say.
 *  - On a **Draft** or **Pending** submission nothing has been paid yet, so
 *    re-pricing is safe — but still only where the run backing the line is
 *    unambiguous, and still only when explicitly asked for.
 *
 * So: `dry_run` reports. `dry_run: false` **still only reports** unless
 * `apply_underbilled: true` is passed, and even then it touches nothing that
 * is not an unpaid submission with exactly one matching run.
 *
 * ## Why "flag" and not "correct" for the ambiguous cases
 *
 * A per-unit rate billed once and a genuinely cheap total are the same number.
 * With no run to compare against, the two are indistinguishable from the data,
 * and guessing wrong invents a payment nobody agreed to. Those land in
 * `unmatched` and are reported for a human.
 */

/** Hard cap per call — bounds both the scan and the blast radius. */
export const MAX_PAYOUT_AUDIT_SCAN = 1000

/** Submission statuses whose money has not moved yet. */
export const UNPAID_STATUSES = ["Draft", "Pending"] as const

const paramsSchema = z.object({
  /** Restrict to one partner (default: every partner). */
  partner_id: z.string().min(1).optional(),
  /** Restrict to one submission — the safe way to apply a single correction. */
  submission_id: z.string().min(1).optional(),
  /**
   * Re-price confidently-underbilled lines on UNPAID submissions.
   *
   * Ignored entirely while `dry_run` is true, and never applies to a
   * Paid/Approved/Under_Review submission regardless of value.
   */
  apply_underbilled: z.boolean().optional().default(false),
  /**
   * Also write `quantity` / `unit_amount` onto matched lines without changing
   * `amount`. Pure enrichment — makes an existing row say "9 x 850" — and safe
   * on a Paid submission precisely because the total is left alone.
   */
  backfill_breakdown: z.boolean().optional().default(false),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PAYOUT_AUDIT_SCAN)
    .optional()
    .default(200),
})

export type PayoutVerdict =
  /** Billed one unit's worth of a multi-unit run. The defect. */
  | "underbilled"
  /** Already equals the run's payable total. Nothing to do. */
  | "correct"
  /** A single-unit run — under- and correctly-billed are the same number. */
  | "single_unit"
  /** Matches neither figure. Reported, never touched. */
  | "unmatched"

/**
 * PURE: how one design line compares with the run that should back it.
 *
 * 🔑 `single_unit` is deliberately NOT folded into `correct`. On a run of one,
 * the per-unit cost and the payable total are the same number, so the line is
 * evidence of nothing — calling it "correct" would let a report claim the
 * defect was absent where it merely could not be observed.
 *
 * Compared with a tolerance rather than `===`: `amount` round-trips through a
 * numeric column and a bigNumber, and both sides are already rounded to paise.
 */
export function classifyPayoutLine(input: {
  amount: number
  run: RunForPayout
  tolerance?: number
}): { verdict: PayoutVerdict; expected: number; unit_amount: number; quantity: number } {
  const tolerance = input.tolerance ?? 0.02
  const expected = runPayableAmount(input.run)
  const unit_amount = runUnitCost(input.run)

  const ordered = Number(input.run?.quantity)
  const quantity = Number.isFinite(ordered) && ordered > 0 ? ordered : 1

  const amount = Number(input.amount)
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance

  if (quantity <= 1) {
    return { verdict: "single_unit", expected, unit_amount, quantity }
  }
  if (near(amount, expected)) {
    return { verdict: "correct", expected, unit_amount, quantity }
  }
  if (near(amount, unit_amount)) {
    return { verdict: "underbilled", expected, unit_amount, quantity }
  }
  return { verdict: "unmatched", expected, unit_amount, quantity }
}

/**
 * PURE: which run backs a design line.
 *
 * Precedence, strongest evidence first:
 *
 *  1. `metadata.production_run_id` on the submission — the auto-draft records
 *     it, and it is a fact rather than an inference.
 *  2. Exactly ONE completed non-sample run for this design and partner.
 *
 * 🔴 Two or more candidate runs returns null on purpose. Picking "the latest"
 * would silently attribute a payment to a run that may not be the one it was
 * for, and the whole point of this job is to stop guessing at amounts.
 */
export function resolveBackingRun(input: {
  design_id: string
  recorded_run_id?: string | null
  runs: Array<RunForPayout & { id?: string; run_type?: string | null }>
}): { run: RunForPayout & { id?: string }; basis: "recorded" | "sole_run" } | null {
  const recorded = String(input.recorded_run_id ?? "").trim()
  if (recorded) {
    const hit = input.runs.find((r) => r.id === recorded)
    if (hit) return { run: hit, basis: "recorded" }
  }

  const candidates = input.runs.filter(
    (r) =>
      r.design_id === input.design_id &&
      String(r.status || "") === "completed" &&
      r.run_type !== "sample" &&
      Number(r.partner_cost_estimate) > 0
  )

  return candidates.length === 1
    ? { run: candidates[0], basis: "sole_run" }
    : null
}

export const auditPartnerPayoutQuantityJob: MaintenanceJob = {
  id: "audit-partner-payout-quantity",
  label: "Find payment lines that billed one piece for a multi-piece run",
  description:
    `Compare every design-sourced payment_submission_item against the production run that backs it, and report the lines that billed a PER-UNIT rate as the whole amount. design.estimated_cost / production_cost are per finished unit, and create-payment-submission used that figure as the line total with no quantity anywhere — so a design costed at 850/unit and produced nine times billed 850 (#1554). 🔴 REPORTS BY DEFAULT AND CHANGES NOTHING, even with dry_run=false: the defect under-pays an artisan, so the correction is a payment decision rather than a data repair. Pass apply_underbilled=true to re-price confidently-underbilled lines, which is honoured ONLY on Draft/Pending submissions (nothing Paid, Approved or Under_Review is ever edited — the money there has moved or been committed, and rewriting the row would make our record disagree with what was actually paid without putting a rupee in anyone's hand) and ONLY where exactly one completed non-sample run backs the line. Lines matching neither the per-unit nor the payable figure are reported as 'unmatched' and never touched: a per-unit rate billed once and a genuinely cheap total are the same number, and guessing invents a payment nobody agreed to. Pass backfill_breakdown=true to additionally record quantity/unit_amount on matched lines WITHOUT changing any amount — safe on a paid submission for exactly that reason. Scans up to 'limit' submissions per call (default 200, max ${MAX_PAYOUT_AUDIT_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to one partner (default: all)",
    },
    {
      name: "submission_id",
      type: "string",
      required: false,
      description:
        "Restrict to one submission — the safe way to apply a single correction",
    },
    {
      name: "apply_underbilled",
      type: "boolean",
      required: false,
      description:
        "Re-price confidently-underbilled lines on Draft/Pending submissions only (default false — the job otherwise reports and changes nothing)",
    },
    {
      name: "backfill_breakdown",
      type: "boolean",
      required: false,
      description:
        "Record quantity/unit_amount on matched lines without changing any amount (default false)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max submissions to scan in one call (default 200, max ${MAX_PAYOUT_AUDIT_SCAN})`,
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
    const {
      partner_id,
      submission_id,
      apply_underbilled,
      backfill_breakdown,
      limit,
    } = parsed.data

    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const submissionsService: any = container.resolve(PAYMENT_SUBMISSIONS_MODULE)
    const runsService: any = container.resolve(PRODUCTION_RUNS_MODULE)

    const filters: Record<string, unknown> = {}
    if (partner_id) filters.partner_id = partner_id
    if (submission_id) filters.id = submission_id

    const submissions: any[] = await submissionsService.listPaymentSubmissions(
      filters,
      { take: limit, order: { created_at: "DESC" } }
    )

    if (!submissions.length) {
      return {
        job_id: "audit-partner-payout-quantity",
        dry_run,
        applied: false,
        summary: "No payment submissions matched the filters.",
        changes: [],
      }
    }

    const submissionById = new Map<string, any>(
      submissions.map((s: any) => [s.id, s])
    )

    const items: any[] = await submissionsService.listPaymentSubmissionItems({
      submission_id: submissions.map((s: any) => s.id),
      source_type: "design",
    })

    const designIds = [
      ...new Set(items.map((i: any) => i.design_id).filter(Boolean)),
    ]

    /**
     * Every run for the designs in scope, fetched once. Filtering to completed
     * happens in `resolveBackingRun` rather than here so the "more than one
     * candidate" count is over the same set the decision is made on.
     */
    const runs: any[] = designIds.length
      ? await runsService.listProductionRuns(
          { design_id: designIds },
          { take: MAX_PAYOUT_AUDIT_SCAN }
        )
      : []

    const runsByDesign = new Map<string, any[]>()
    for (const r of runs) {
      const key = String(r.design_id ?? "")
      if (!key) continue
      if (!runsByDesign.has(key)) runsByDesign.set(key, [])
      runsByDesign.get(key)!.push(r)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const tally: Record<string, number> = {
      underbilled: 0,
      correct: 0,
      single_unit: 0,
      unmatched: 0,
      no_run: 0,
    }
    let repriced = 0
    let enriched = 0
    let shortfall = 0

    for (const item of items) {
      const submission = submissionById.get(item.submission_id)
      if (!submission) continue

      const designId = String(item.design_id ?? "")
      if (!designId) continue

      const candidateRuns = (runsByDesign.get(designId) || []).filter(
        (r: any) => !submission.partner_id || r.partner_id === submission.partner_id
      )

      const backing = resolveBackingRun({
        design_id: designId,
        recorded_run_id: submission?.metadata?.production_run_id,
        runs: candidateRuns,
      })

      if (!backing) {
        tally.no_run++
        errors.push({
          id: item.id,
          message: candidateRuns.length
            ? `${candidateRuns.length} candidate runs for design ${designId} and no production_run_id on the submission — refusing to guess which one this line paid for.`
            : `No completed production run found for design ${designId} — nothing to compare this line against.`,
        })
        continue
      }

      const amount = Number(item.amount)
      const { verdict, expected, unit_amount, quantity } = classifyPayoutLine({
        amount,
        run: backing.run,
      })
      tally[verdict]++

      const unpaid = (UNPAID_STATUSES as readonly string[]).includes(
        String(submission.status)
      )

      if (verdict === "underbilled") {
        shortfall += expected - amount
      }

      // ── Report ────────────────────────────────────────────────────────────
      if (verdict === "underbilled") {
        changes.push({
          entity: "payment_submission_item",
          id: item.id,
          field: `amount (submission ${submission.id}, ${submission.status}, run ${
            (backing.run as any).id
          } via ${backing.basis}: ${quantity} x ${unit_amount})`,
          before: amount,
          after: unpaid && apply_underbilled && !dry_run
            ? expected
            : `${expected} — REPORTED ONLY${
                unpaid ? "" : ` (${submission.status}: money has moved or been committed)`
              }`,
        })
      }

      if (dry_run) continue

      // ── Apply ─────────────────────────────────────────────────────────────
      try {
        const update: Record<string, unknown> = { id: item.id }
        let touched = false

        if (verdict === "underbilled" && apply_underbilled && unpaid) {
          update.amount = expected
          update.quantity = quantity
          update.unit_amount = unit_amount
          touched = true
          repriced++
        } else if (
          backfill_breakdown &&
          (verdict === "correct" || verdict === "underbilled") &&
          unit_amount > 0
        ) {
          // Breakdown only — `amount` is deliberately absent from this branch.
          update.quantity = quantity
          update.unit_amount = unit_amount
          touched = true
          enriched++
        }

        if (!touched) continue

        await submissionsService.updatePaymentSubmissionItems(update)

        // The submission total has to follow the line, or the two disagree and
        // the header keeps showing the amount that was wrong.
        if (update.amount != null) {
          const siblings: any[] =
            await submissionsService.listPaymentSubmissionItems({
              submission_id: submission.id,
            })
          const total = siblings.reduce(
            (sum: number, s: any) =>
              sum + Number(s.id === item.id ? expected : s.amount),
            0
          )
          await submissionsService.updatePaymentSubmissions({
            id: submission.id,
            total_amount: Math.round(total * 100) / 100,
          })
          changes.push({
            entity: "payment_submission",
            id: submission.id,
            field: "total_amount",
            before: Number(submission.total_amount),
            after: Math.round(total * 100) / 100,
          })
        }
      } catch (e: any) {
        errors.push({ id: item.id, message: e?.message ?? String(e) })
        logger?.warn?.(
          `[audit-partner-payout-quantity] item ${item.id} failed: ${e?.message ?? e}`
        )
      }
    }

    const found =
      `${tally.underbilled} underbilled, ${tally.correct} correct, ` +
      `${tally.single_unit} single-unit (unobservable), ${tally.unmatched} unmatched, ` +
      `${tally.no_run} with no comparable run`

    const shortfallText = tally.underbilled
      ? ` Underpayment across those lines: ${Math.round(shortfall * 100) / 100}.`
      : ""

    const summary = dry_run
      ? `Scanned ${items.length} design line(s) across ${submissions.length} submission(s): ${found}.${shortfallText} Dry run — nothing written.`
      : `Scanned ${items.length} design line(s) across ${submissions.length} submission(s): ${found}.${shortfallText} Repriced ${repriced}; recorded a breakdown on ${enriched}.${
          tally.underbilled && !apply_underbilled
            ? " apply_underbilled was not set, so no amount was changed."
            : ""
        }`

    return {
      job_id: "audit-partner-payout-quantity",
      dry_run,
      applied: !dry_run && repriced + enriched > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
