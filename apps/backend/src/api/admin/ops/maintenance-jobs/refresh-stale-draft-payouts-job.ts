import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import { assessRunPayout } from "../../../../workflows/production-runs/lib/run-payable"
import {
  assessDraftLine,
  summarizeDraftSweep,
  type DraftPayoutLine,
  type ExpectedPayout,
} from "./lib/stale-draft-payout"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — re-price unclaimed Draft payouts that no longer match their run.
 *
 * ## The gap this closes
 *
 * `refreshUnclaimedDraftPayouts` already exists and is correct. It fires from
 * exactly ONE place: the admin production-run PATCH route. So a Draft is
 * re-priced only if somebody happens to correct that run through that route.
 * Nothing sweeps, and nothing ever revisits a Draft raised before a correction
 * arrived by any other path — an ops job, run completion writing
 * `produced_quantity`, or a correction made before that route existed.
 *
 * 🔴 There is no route that could repair one either. A submission has GET and
 * `review`, and `review` refuses anything that is not Pending or Under_Review,
 * so a stale Draft cannot be edited, rejected or discarded through the API at
 * all. On production one such Draft sat at ₹1,190/unit against a run since
 * corrected to ₹840 total — and a reviewer would have approved it.
 *
 * ## It is an instrument before it is a repair
 *
 * The dry run is the point. Every row states the run it measured against and
 * the figures on both sides, so a wrong row is visible without re-deriving the
 * sweep by hand. Rows it CANNOT judge are reported as their own count, not
 * folded into "examined" — a sweep that says "3 of 200 stale" while 150 were
 * unknowable has told the operator the opposite of the truth about its own
 * coverage.
 *
 * ## Draft, and only ever Draft
 *
 * ⚠️ A Draft is system-written and unsubmitted: nobody has claimed it, so
 * re-pricing takes nothing away from anyone. Every other status is a live claim
 * — a partner has asked for that amount, or it has been approved or paid — and
 * silently rewriting one would change what somebody is owed without them
 * seeing it. Those are never touched, by this job or by the correction path.
 *
 * The expected figures come from `assessRunPayout`, the same function the
 * subscriber drafted with and the correction path re-prices with, so a sweep
 * cannot quietly change the BASIS of a figure (it bills ordered, not produced).
 */
export const refreshStaleDraftPayoutsJob: MaintenanceJob = {
  id: "refresh-stale-draft-payouts",
  label: "Re-price stale Draft payouts",
  description:
    "Find unclaimed DRAFT payment submissions whose figures no longer match the production run they were pre-filled from, and re-price them. Re-pricing already happens when a run is corrected through the admin route, but that is the only trigger there is — a draft raised before a correction arrived by any other path (an ops job, run completion writing produced_quantity) keeps its old numbers and goes on looking authoritative, and no route can fix it because `review` refuses anything that is not Pending or Under_Review. Expected figures come from `assessRunPayout`, the same function that drafted them, so the BASIS never changes — only the inputs. ONLY ever touches status Draft: every other status is a live claim somebody has made and must not be rewritten under them. Reports rows it cannot judge (a line collapsing several runs, a line whose run provenance is not `recorded`, a run with no payable figure) as skipped WITH the reason, rather than guessing. Creates nothing, pays nothing, emails nobody. Safe to re-run.",
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description:
        "Limit to one design's draft lines. Omit to sweep every unclaimed draft.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Maximum draft lines to examine (default 500).",
    },
  ],

  async run(container: any, opts): Promise<MaintenanceJobResult> {
    const service: any = container.resolve(PAYMENT_SUBMISSIONS_MODULE)
    const runService: any = container.resolve("production_runs")

    const designId = opts.params?.design_id
      ? String(opts.params.design_id)
      : null
    const limit = Math.min(Number(opts.params?.limit ?? 500) || 500, 2000)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    /**
     * 🔴 Filtered explicitly, never `{ design_id: undefined }`. That shape is
     * NO filter rather than "no rows" (#1433) — here it would silently widen a
     * one-design repair into a sweep of every draft on the platform.
     */
    const filters: Record<string, any> = {}
    if (designId) filters.design_id = [designId]

    const items = (await service.listPaymentSubmissionItems(filters, {
      relations: ["submission"],
      take: limit,
    })) as any[]

    let examined = 0
    let stale = 0
    /** Of `stale`, the lines whose AMOUNT actually moves. */
    let repriced = 0
    let current = 0
    let skipped = 0

    // One run lookup per run, not per line — a design with many drafts would
    // otherwise re-fetch the same run for each of them.
    const payoutCache = new Map<string, ExpectedPayout | null>()

    for (const item of items || []) {
      // Draft is the only status this job may consider AT ALL, so the filter
      // is here rather than in the verdict: a live claim must not even appear
      // in the report as something that "would be re-priced".
      if (String(item?.submission?.status || "") !== "Draft") continue

      examined++

      const line: DraftPayoutLine = {
        item_id: String(item.id),
        submission_id: String(item.submission?.id || item.submission_id || ""),
        design_id: item.design_id ? String(item.design_id) : null,
        production_run_ids: Array.isArray(item.production_run_ids)
          ? (item.production_run_ids as string[]).map(String)
          : [],
        run_provenance: item.run_provenance ?? null,
        amount: item.amount == null ? null : Number(item.amount),
        quantity: item.quantity == null ? null : Number(item.quantity),
        unit_amount: item.unit_amount == null ? null : Number(item.unit_amount),
      }

      const runId = line.production_run_ids[0]
      let expected: ExpectedPayout = {
        eligible: false,
        amount: 0,
        quantity: 0,
        unit_amount: 0,
      }

      if (runId && line.run_provenance === "recorded") {
        if (!payoutCache.has(runId)) {
          try {
            const run = await runService.retrieveProductionRun(runId)
            const payout = assessRunPayout(run)
            /**
             * 🔑 Narrowed on `eligible`, because the ineligible branch of
             * `PayoutEligibility` carries only a `reason` — it has no money
             * fields at all. Reading `payout.amount` off the union would have
             * been `undefined` at runtime and `Number(undefined) || 0` turns
             * that into a confident ZERO, which is the one value this job must
             * never write. tsc caught it; no test would have.
             */
            payoutCache.set(
              runId,
              payout.eligible
                ? {
                    eligible: true,
                    amount: Number(payout.amount) || 0,
                    quantity: Number(payout.quantity) || 0,
                    unit_amount: Number(payout.unit_amount) || 0,
                  }
                : { eligible: false, amount: 0, quantity: 0, unit_amount: 0 }
            )
          } catch (e: any) {
            // A named run we cannot read is a REPORTED failure, not a silent
            // skip: the line claims that run and we could not check it.
            payoutCache.set(runId, null)
            errors.push({
              id: line.submission_id || line.item_id,
              message: `run ${runId} could not be read: ${e?.message ?? e}`,
            })
          }
        }
        const cached = payoutCache.get(runId)
        if (cached === null) {
          skipped++
          continue
        }
        if (cached) expected = cached
      }

      const verdict = assessDraftLine(line, expected)

      if (verdict.verdict === "current") {
        current++
        continue
      }

      if (verdict.verdict === "skipped") {
        skipped++
        changes.push({
          entity: "payment_submission_item",
          id: line.item_id,
          field: "skipped",
          before: line.amount,
          after: line.amount,
          reason: verdict.reason,
        } as MaintenanceChange)
        continue
      }

      stale++
      /**
       * Whether this line's MONEY moves, or only the breakdown behind it.
       * Counted apart because the summary must not call a `unit_amount`
       * backfill a re-pricing — see `summarizeDraftSweep`.
       */
      if (Number(line.amount) !== Number(verdict.expected.amount)) {
        repriced++
      }
      changes.push({
        entity: "payment_submission_item",
        id: line.item_id,
        field: "amount",
        before: line.amount,
        after: verdict.expected.amount,
        reason: verdict.reason,
      } as MaintenanceChange)

      if (opts.dry_run) continue

      try {
        await service.updatePaymentSubmissionItems({
          id: line.item_id,
          amount: verdict.expected.amount,
          quantity: verdict.expected.quantity,
          unit_amount: verdict.expected.unit_amount,
        })

        /**
         * The submission total is STORED, not derived, so it has to move too.
         * A line and a header that disagree is worse than either being wrong
         * alone — a reviewer reads the header.
         */
        if (line.submission_id) {
          const siblings = (await service.listPaymentSubmissionItems(
            { submission_id: line.submission_id },
            {}
          )) as any[]
          const total = (siblings || []).reduce(
            (sum: number, s: any) =>
              sum +
              (String(s.id) === line.item_id
                ? verdict.expected.amount
                : Number(s.amount) || 0),
            0
          )
          await service.updatePaymentSubmissions({
            id: line.submission_id,
            total_amount: Math.round(total * 100) / 100,
          })
        }
      } catch (e: any) {
        errors.push({
          id: line.submission_id || line.item_id,
          message: `re-price failed: ${e?.message ?? e}`,
        })
      }
    }

    return {
      job_id: "refresh-stale-draft-payouts",
      dry_run: opts.dry_run,
      applied: !opts.dry_run && stale > 0,
      summary: summarizeDraftSweep({
        examined,
        stale,
        repriced,
        current,
        skipped,
        dryRun: opts.dry_run,
      }),
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}
