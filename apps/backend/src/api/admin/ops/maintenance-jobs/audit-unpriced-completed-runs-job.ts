import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { isProvenanceRun } from "../../../../workflows/consumption-logs/lib/reconcile-production-consumption"
import { listPartnerSubmissionItems } from "../../../../workflows/payment_submissions/lib/run-claims"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Find completed production runs that nobody has ever put a price on (#1712).
 *
 * ## What this is for
 *
 * `prod_run_01KP4ZVE3R` — Prince Tailors, Tangaliya Weave Flowy Skirt — was
 * completed, produced 2 pieces, and carried `partner_cost_estimate: null` for
 * **four months**. Nobody was hiding it: `payable-runs` lists it, the create
 * grid badges it "no rate" and prints an em dash instead of a 0, and an
 * operator can type the rate straight into the row.
 *
 * The gap is that all of that is PULL. The run is only visible to someone who
 * already decided to open that partner's payout screen, and nothing ever said
 * "this finished work has no agreed price". So a partner waits, and the silence
 * looks exactly like a partner with no outstanding work.
 *
 * This job is the push side: it asks the question nobody was asking.
 *
 * ## 🔴 Report-only, always — there is nothing here to repair
 *
 * Unlike every `backfill-*` job, the missing datum is not derivable. A run's
 * agreed price is a thing two people said to each other; it is not in the
 * database in another shape. `design.estimated_cost` is NOT it — that figure is
 * per finished unit and routinely disagrees with what was agreed (pricing
 * Bakshi's from the design would bill 11,530.80 against the run's 7,650, which
 * is #1554). It is reported here as a STARTING POINT for the human who types
 * the real number, and is never written anywhere.
 *
 * So `dry_run: false` changes nothing either, deliberately. `applied` is always
 * false. This job creates nothing, pays nobody and emails no one.
 *
 * ## Why "no rate" and "a rate of zero" are counted separately
 *
 * `runPayableOffer` treats both as unpayable and it is right to. But they are
 * different events: `null` means the question was never answered, while a
 * stored `0` means something WROTE a zero — and a 0 passes every `!= null`
 * check, sums cleanly into a total and renders as a real payout of nothing.
 * That is how an estimator's "found nothing = 0" reached a storefront till
 * (#1564). Folding them together would hide the worse of the two.
 */

/** Hard cap per call — bounds the scan, and is reported when it bites. */
export const MAX_UNPRICED_RUN_SCAN = 1000

export type RunPricingVerdict =
  /** An agreed rate or total is recorded. Nothing to report. */
  | "priced"
  /** No figure was ever written. The question was never answered. */
  | "no_rate_recorded"
  /** A figure WAS written, and it is zero or negative. Something decided this. */
  | "zero_rate_recorded"

export type RunForPricingAudit = {
  id?: string
  partner_cost_estimate?: number | null
}

/**
 * PURE: whether a run carries a usable agreed price, and which kind of absence
 * it has when it does not.
 *
 * 🔑 Reads the RAW field before coercing. `Number(null)` is 0, so testing the
 * coerced value first would report every never-priced run as one that had a
 * zero deliberately written to it — the exact confusion this split exists to
 * prevent (#1676 bit three times on this).
 *
 * Matches `runPayableOffer`'s threshold exactly (`> 0` after coercion), so a
 * run this job reports is precisely a run that screen shows as unpayable. A
 * second, differently-drawn line would let the report and the screen disagree
 * about who is waiting to be paid.
 */
export function assessRunPricing(
  run: RunForPricingAudit | null | undefined
): { verdict: RunPricingVerdict; agreed: number | null } {
  const raw = run?.partner_cost_estimate

  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { verdict: "no_rate_recorded", agreed: null }
  }

  const agreed = Number(raw)
  if (!Number.isFinite(agreed)) {
    return { verdict: "no_rate_recorded", agreed: null }
  }
  if (agreed <= 0) {
    return { verdict: "zero_rate_recorded", agreed }
  }
  return { verdict: "priced", agreed }
}

/**
 * PURE: whether a run has a partner who could be owed for it.
 *
 * 🔴 Runs come in parent/child pairs — the parent holds the total, the CHILD
 * holds the partner and the money — so a parent is `partner_id: null` with
 * `partner_cost_estimate: null` BY CONSTRUCTION. `payable-runs` never sees one
 * because it filters on `partner_id`; an audit over every completed run has to
 * exclude them explicitly or it reports the shape of the record as a debt.
 *
 * Measured on this job's first production run: 30 of 39 rows were parents,
 * each the twin of a child reported one second apart.
 */
export function hasPartnerOwner(
  run: { partner_id?: string | null } | null | undefined
): boolean {
  return !!String(run?.partner_id ?? "").trim()
}

/**
 * PURE: how long this work has been sitting unpriced, in whole days.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so the report can be
 * tested against a fixed clock instead of being assertable only to the day.
 * Returns null when the run never recorded a completion date — an unknown age
 * is not an age of zero.
 */
export function daysSinceCompletion(
  completedAt: string | Date | null | undefined,
  now: Date
): number | null {
  if (!completedAt) return null
  const then = new Date(completedAt as any).getTime()
  if (!Number.isFinite(then)) return null
  const days = Math.floor((now.getTime() - then) / 86_400_000)
  return days >= 0 ? days : null
}

const paramsSchema = z.object({
  /** Restrict to one partner (default: every partner). */
  partner_id: z.string().min(1).optional(),
  /**
   * Only report runs finished at least this many days ago. 0 reports
   * everything, which is the honest default for an audit — a run completed
   * yesterday with no price is still a run with no price.
   */
  min_age_days: z.number().int().min(0).max(3650).optional().default(0),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_UNPRICED_RUN_SCAN)
    .optional()
    .default(200),
})

export const auditUnpricedCompletedRunsJob: MaintenanceJob = {
  id: "audit-unpriced-completed-runs",
  label: "Find completed production runs that carry no agreed price",
  description:
    `Report every COMPLETED production run whose partner_cost_estimate is absent or zero, so finished work with no agreed price stops waiting to be noticed. prod_run_01KP4ZVE3R sat unpriced for four months: nothing hid it — payable-runs lists it and the create grid badges it "no rate" — but all of that is PULL, visible only to someone who already opened that partner's payout screen, and a partner with unpriced work looks exactly like a partner with no work (#1712). 🔴 REPORTS ONLY AND CHANGES NOTHING, even with dry_run=false: a run's agreed price is a thing two people said to each other and is not derivable from anything in the database. design.estimated_cost is NOT it — that figure is per finished unit and routinely disagrees with what was agreed (#1554) — so it is reported beside each row as a STARTING POINT for the human who types the real number, and is written nowhere. PARENT runs are excluded — runs come in parent/child pairs and the CHILD carries the partner and the money, so a parent is partner_id null with no estimate by construction (30 of 39 rows on the first production run were parents). Runs already claimed by a live payout are excluded (a Rejected submission releases its runs), as are provenance runs minted by a retail fulfilment, which are not billable labour (#1606). "No rate recorded" and "a zero was written" are counted separately on purpose: both are unpayable, but a stored 0 means something decided this, and a 0 passes every != null check and renders as a real payout of nothing. Scans up to 'limit' completed runs per call (default 200, max ${MAX_UNPRICED_RUN_SCAN}), newest first, and says so when the cap bites.`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to one partner (default: all)",
    },
    {
      name: "min_age_days",
      type: "number",
      required: false,
      description:
        "Only report runs completed at least this many days ago (default 0 — report everything)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max completed runs to scan in one call (default 200, max ${MAX_UNPRICED_RUN_SCAN})`,
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
    const { partner_id, min_age_days, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const now = new Date()

    const filters: Record<string, unknown> = { status: "completed" }
    if (partner_id) filters.partner_id = partner_id

    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: [
        "id",
        "design_id",
        "partner_id",
        "status",
        "quantity",
        "produced_quantity",
        "partner_cost_estimate",
        "cost_type",
        "completed_at",
        "order_id",
        // Read by `isProvenanceRun` — a guard reading a field the query never
        // fetched is dead code that types perfectly (#1606).
        "metadata",
      ],
      filters,
      pagination: { take: limit + 1, order: { completed_at: "DESC" } },
    })

    const scanned = ((runs || []) as any[]).filter(Boolean)
    /**
     * A silent cap reads as "covered everything". One row over the limit is
     * fetched purely so the summary can say the scan was truncated rather than
     * implying the list is the whole population.
     */
    const truncated = scanned.length > limit
    const inScope = truncated ? scanned.slice(0, limit) : scanned

    /**
     * A run minted by a retail fulfilment shipped from stock is not unpaid
     * labour with a missing price — there was no shop-floor work in it at all,
     * and reporting one as "waiting to be priced" would send an operator to
     * invent a payment for work nobody did (#1606, #1123).
     */
    const provenanceRuns = inScope.filter((r) => isProvenanceRun(r))
    const nonProvenance = inScope.filter((r) => !isProvenanceRun(r))

    /**
     * 🔴 PARENT runs. Runs come in parent/child pairs — the parent holds the
     * total, the CHILD holds the partner and the money — and a parent is
     * `partner_id: null` with `partner_cost_estimate: null` by construction.
     * `payable-runs` never sees one because it filters on `partner_id`; this
     * job asks the question of every completed run, so without this it reports
     * every parent as unpaid work.
     *
     * Measured on the first production run of this job: **30 of 39 rows were
     * parents**, each the twin of a child reported one second apart. Nobody is
     * owed for a parent, so "this has no agreed price" is not a finding about
     * it — it is the shape of the record.
     *
     * Counted and reported, never silently dropped: a row this job holds back
     * is a row an operator would otherwise have gone looking for.
     */
    const parentRuns = nonProvenance.filter((r) => !hasPartnerOwner(r))
    const candidates = nonProvenance.filter((r) => hasPartnerOwner(r))

    const unpriced = candidates
      .map((run) => ({ run, ...assessRunPricing(run) }))
      .filter((row) => row.verdict !== "priced")

    /**
     * Runs already claimed by a live payout.
     *
     * A run can be billed by a line that states an explicit amount — that is
     * the NORMAL path for a run carrying no rate, and `resolveRunLineAmount`
     * exists to make it so. Such a run has no missing price problem: somebody
     * already said what it was worth. Reporting it would send an operator to
     * price work that has been paid for.
     *
     * ⚠️ A Rejected submission releases its runs, matching `foldPartnerBilling`
     * — a rejected claim is not a payment.
     */
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const partnerIds = [
      ...new Set(
        unpriced.map((row) => String(row.run.partner_id ?? "")).filter(Boolean)
      ),
    ]

    const claimedRunIds = new Set<string>()
    const errors: Array<{ id: string; message: string }> = []
    for (const pid of partnerIds) {
      try {
        const items = await listPartnerSubmissionItems(service as any, pid)
        for (const item of items || []) {
          if (String(item?.submission?.status || "") === "Rejected") continue
          for (const runId of (item?.production_run_ids || []) as string[]) {
            claimedRunIds.add(String(runId))
          }
        }
      } catch (e: any) {
        /**
         * A partner whose claims could not be read is reported, never assumed
         * clear: treating the failure as "nothing is claimed" would put already
         * paid work on a list headed "needs a price".
         */
        errors.push({
          id: pid,
          message: `Could not read existing claims for this partner, so their unpriced runs are omitted rather than reported as unclaimed: ${
            e?.message ?? String(e)
          }`,
        })
      }
    }
    const unreadablePartners = new Set(errors.map((e) => e.id))

    const reportable = unpriced.filter(
      (row) =>
        !claimedRunIds.has(String(row.run.id)) &&
        !unreadablePartners.has(String(row.run.partner_id ?? ""))
    )

    const designIds = [
      ...new Set(
        reportable.map((row) => String(row.run.design_id ?? "")).filter(Boolean)
      ),
    ]
    const { data: designs } = designIds.length
      ? await query.graph({
          entity: "designs",
          fields: ["id", "name", "estimated_cost", "production_cost"],
          filters: { id: designIds },
        })
      : { data: [] as any[] }
    const designById = new Map(
      ((designs || []) as any[]).map((d: any) => [String(d.id), d])
    )

    const aged = reportable
      .map((row) => ({
        ...row,
        age_days: daysSinceCompletion(row.run.completed_at, now),
      }))
      .filter(
        (row) =>
          min_age_days === 0 ||
          (row.age_days != null && row.age_days >= min_age_days)
      )
      /** Longest-waiting first: that is the order an operator should work in. */
      .sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1))

    const changes: MaintenanceChange[] = aged.map((row) => {
      const run = row.run
      const design = designById.get(String(run.design_id ?? ""))
      const produced = Number(run.produced_quantity)
      const hasProduced = Number.isFinite(produced) && produced > 0
      /**
       * ⚠️ The RAW ordered figure. `Number(null)` is 0, and a run reported as
       * "ordered 0" is a different and much worse statement than one that never
       * agreed a quantity — which since #1676 is a legitimate open-ended run.
       */
      const ordered =
        run.quantity === null || run.quantity === undefined
          ? null
          : Number(run.quantity)

      const suggestion =
        design?.production_cost != null
          ? `design production_cost ${Number(design.production_cost)}/unit`
          : design?.estimated_cost != null
            ? `design estimated_cost ${Number(design.estimated_cost)}/unit`
            : "no design cost to start from either"

      return {
        entity: "production_run",
        id: String(run.id),
        field: `partner_cost_estimate (cost_type ${run.cost_type ?? "unset — read as total"})`,
        before: row.verdict === "zero_rate_recorded" ? row.agreed : null,
        after: "REPORTED ONLY — a human must state the agreed price",
        note:
          `${row.verdict === "zero_rate_recorded" ? "A zero was written" : "No rate was ever recorded"}. ` +
          `Partner ${run.partner_id ?? "unknown"}, design ${
            design?.name ?? run.design_id ?? "none"
          }, ` +
          `produced ${hasProduced ? produced : "not recorded"} of ${
            ordered ?? "no agreed quantity"
          } ordered, ` +
          `completed ${run.completed_at ?? "date not recorded"}${
            row.age_days != null ? ` (${row.age_days} days ago)` : ""
          }. ` +
          `Starting point: ${suggestion} — a suggestion, never a price (#1554).`,
      }
    })

    const zeroWritten = aged.filter(
      (r) => r.verdict === "zero_rate_recorded"
    ).length
    const neverPriced = aged.length - zeroWritten

    const summary = aged.length
      ? `${aged.length} completed run(s) carry no agreed price — ${neverPriced} never priced, ${zeroWritten} with a zero written. ` +
        `Nothing was changed: the agreed price is not derivable and must be typed by someone who knows it. ` +
        `Scanned ${inScope.length} completed run(s)${
          truncated
            ? ` — TRUNCATED at the limit of ${limit}, so this is not the whole population; raise 'limit' or narrow by partner_id`
            : ""
        }, excluded ${parentRuns.length} parent run(s) — the child carries the partner and the money — ${provenanceRuns.length} provenance run(s) and ${
          unpriced.length - reportable.length
        } already claimed by a live payout.`
      : `No unpriced completed runs found. Scanned ${inScope.length} completed run(s)${
          truncated ? ` — TRUNCATED at the limit of ${limit}` : ""
        }, excluded ${parentRuns.length} parent run(s) and ${provenanceRuns.length} provenance run(s).`

    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger?.info?.(`[audit-unpriced-completed-runs] ${summary}`)

    return {
      job_id: "audit-unpriced-completed-runs",
      dry_run,
      /**
       * 🔴 Always false. There is no apply path: `dry_run: false` reports the
       * same thing, because the missing figure cannot be derived from anything
       * here. Saying `applied: true` because the job ran would claim a repair
       * that did not happen.
       */
      applied: false,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
