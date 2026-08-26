import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { runUnitCost } from "../../../../workflows/production-runs/lib/run-payable"

/**
 * GET /admin/payment-submissions/payable-runs?partner_id=…
 *
 * The completed production runs a partner can be paid for, one row per RUN.
 *
 * ## Why this exists
 *
 * The admin submission screen listed DESIGNS. A design is not a payable thing —
 * it is a recipe, produced many times, and the money lives on the run: the rate
 * a partner agreed to (`partner_cost_estimate` + `cost_type`) and how many
 * finished pieces they actually made (`produced_quantity`). Listing designs
 * meant the screen had no quantity to show and no rate to show, so it billed
 * `design.estimated_cost` — a PER-UNIT figure — exactly once. That is #1554,
 * and it was ₹850 for nine garments.
 *
 * Pricing from the design is not a near-miss either: for Bakshi's Design the
 * design's own cost would have billed 11,530.80 where the run says 7,650, and
 * Denim Trouser has no design cost at all and would have billed 0.
 *
 * ## The quantity this bills
 *
 * 🔑 `payable_quantity` is the PRODUCED quantity, not the ordered one — the
 * founder rule is that a partner is paid for what they made. `runPayableAmount`
 * (the auto-draft path) still multiplies by `run.quantity`, which is why a run
 * ordered 9 and produced 4 drafts 9 units' worth unless a caller says
 * otherwise. This endpoint is that caller: it states produced and ordered
 * side by side so the screen shows which one it is billing and the reviewer can
 * see the two disagree.
 *
 * Runs with no produced figure fall back to ordered and are flagged
 * `produced_quantity: null`, so "we never recorded output" is visibly distinct
 * from "they made zero".
 *
 * ## What "already paid for" means
 *
 * A run is billed when a payment line records it in `production_run_ids` and
 * that submission is not Rejected. This is a stronger guard than the existing
 * "is this design in an OPEN submission" check, which stops being true the
 * moment a submission is Approved or Paid — after which the same finished run
 * could be claimed again and the second claim would look exactly as legitimate
 * as the first.
 *
 * ## "Not billed" and "we can't tell" are different answers
 *
 * 🔴 Every payment line in production recorded no run at all, so this guard was
 * inert on real data while the screen showed its output as fact: 13 of 13
 * submissions returned `billed: null`, which the sort then ranked as clean,
 * payable work. Absence read as permission — #1557's shape, on the field that
 * decides whether someone is paid twice.
 *
 * So a run now reports `billing_status`, not just `billed`:
 *
 *   - `clear`   — every live payout for this design names the runs it covered,
 *                 and this is not one of them.
 *   - `unknown` — a live payout for this design is `run_provenance:
 *                 "not_recorded"`: it pays for run work and never said which
 *                 run. This run may already be inside it. A human has to
 *                 establish what that payout covered before any money moves.
 *   - `billed`  — a line names this run.
 *
 * A task payout (`run_provenance: "no_run"`) is not a source of doubt: there
 * was never a run behind it. That distinction is the whole reason provenance is
 * a stated column rather than something re-derived from a NULL. See
 * `payment_submission_item.run_provenance` and #1565.
 *
 * ⚠️ `design_has_open_submission` remains reported alongside, but it is the
 * older, weaker signal — it goes false the moment a submission is Approved.
 * Branch on `billing_status`.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(
    (req.validatedQuery as any)?.partner_id ?? (req.query as any)?.partner_id ?? ""
  ).trim()

  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required"
    )
  }

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Completed runs of this partner. A parent run carries `partner_id: null`
  // (runs come in parent/child pairs — the parent holds the total, the child
  // holds the partner and the money), so filtering on the partner excludes
  // parents without needing a second rule for them.
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: [
      "id",
      "design_id",
      "partner_id",
      "status",
      "quantity",
      "produced_quantity",
      "rejected_quantity",
      "partner_cost_estimate",
      "cost_type",
      "completed_at",
    ],
    filters: { partner_id: partnerId, status: "completed" },
  })

  const completedRuns = ((runs || []) as any[]).filter((r) => !!r.design_id)

  if (!completedRuns.length) {
    return res.status(200).json({ payable_runs: [], count: 0 })
  }

  const designIds = [
    ...new Set(completedRuns.map((r) => String(r.design_id))),
  ]

  const { data: designs } = await query.graph({
    entity: "designs",
    fields: ["id", "name", "status", "estimated_cost", "production_cost"],
    filters: { id: designIds },
  })
  const designById = new Map(
    ((designs || []) as any[]).map((d) => [d.id, d])
  )

  // Prior payment lines for these designs. Scoped to the designs in play rather
  // than every line ever written: a run belongs to exactly one design, so a
  // prior billing of it can only sit on a line for that design.
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const priorItems = (await service.listPaymentSubmissionItems(
    { design_id: designIds },
    { relations: ["submission"] }
  )) as any[]

  const billedRuns = new Map<
    string,
    { submission_id: string; status: string; quantity: number }
  >()
  const designsWithOpenSubmission = new Set<string>()
  /**
   * Designs carrying a live payout that does not say which run it paid for.
   *
   * 🔴 These are the rows that made the guard a fiction. A line with
   * `run_provenance: "not_recorded"` pays for run work, is not Rejected, and
   * names no run — so for every completed run of that design, "is this already
   * paid for?" has no answer. Reporting `billed: null` for those runs said
   * "no", and the screen sorted them to the top as clean, payable work.
   *
   * A `no_run` line (a task payout) is deliberately NOT collected here: that
   * is the one case where a missing run is an answer rather than a gap.
   */
  const designsWithUnrecordedClaims = new Map<
    string,
    { submission_id: string; status: string; amount: number }[]
  >()
  const OPEN_STATUSES = new Set([
    "Draft",
    "Pending",
    "Under_Review",
  ])

  for (const item of priorItems || []) {
    const status = String(item.submission?.status || "")
    // A Rejected submission never paid anyone — its lines release their runs.
    if (status === "Rejected") continue

    if (OPEN_STATUSES.has(status) && item.design_id) {
      designsWithOpenSubmission.add(String(item.design_id))
    }

    if (item.run_provenance === "not_recorded" && item.design_id) {
      const designId = String(item.design_id)
      const claims = designsWithUnrecordedClaims.get(designId) || []
      claims.push({
        submission_id: String(item.submission?.id || item.submission_id || ""),
        status,
        amount: Number(item.amount ?? 0),
      })
      designsWithUnrecordedClaims.set(designId, claims)
    }

    for (const runId of (item.production_run_ids || []) as string[]) {
      if (!billedRuns.has(runId)) {
        billedRuns.set(runId, {
          submission_id: String(item.submission?.id || item.submission_id || ""),
          status,
          quantity: Number(item.quantity ?? 1),
        })
      }
    }
  }

  const payable_runs = completedRuns
    .map((run) => {
      const design = designById.get(String(run.design_id))

      // The per-unit rate the partner agreed, derived from the run rather than
      // the design. `runUnitCost` divides a "total" cost_type back out and
      // takes a "per_unit" one verbatim — one place, one convention.
      const unit_amount = runUnitCost(run)

      const produced = Number(run.produced_quantity)
      const hasProduced = Number.isFinite(produced) && produced > 0
      const ordered = Number(run.quantity)
      const payable_quantity = hasProduced
        ? produced
        : Number.isFinite(ordered) && ordered > 0
          ? ordered
          : 1

      return {
        run_id: String(run.id),
        design_id: String(run.design_id),
        design_name: design?.name ?? null,
        design_status: design?.status ?? null,
        completed_at: run.completed_at ?? null,
        ordered_quantity: Number.isFinite(ordered) ? ordered : null,
        produced_quantity: hasProduced ? produced : null,
        rejected_quantity:
          run.rejected_quantity === null || run.rejected_quantity === undefined
            ? null
            : Number(run.rejected_quantity),
        /** What this row bills for: produced, or ordered when output was never recorded. */
        payable_quantity,
        quantity_basis: hasProduced ? "produced" : "ordered",
        unit_amount,
        amount: Math.round(unit_amount * payable_quantity * 100) / 100,
        cost_type: run.cost_type ?? null,
        partner_cost_estimate:
          run.partner_cost_estimate === null ||
          run.partner_cost_estimate === undefined
            ? null
            : Number(run.partner_cost_estimate),
        /**
         * Whether the RUN carries an agreed rate.
         *
         * ⚠️ This is NOT "can this be paid". A run with no agreed rate is not a
         * zero-value payout and it is not unpayable — it is a run whose price
         * was never written down, and an admin who knows what was agreed must
         * still be able to pay it by typing the rate. Only `billed` blocks.
         */
        payable: unit_amount > 0,
        /**
         * The DESIGN's own cost figures, offered as a starting point when the
         * run carries no rate.
         *
         * 🔴 A suggestion, never a price. `design.estimated_cost` is per
         * finished unit and routinely disagrees with what was actually agreed —
         * pricing Bakshi's from the design would bill 11,530.80 against the
         * run's 7,650. It is returned so the screen can SHOW it next to an
         * empty rate box; nothing may bill from it without someone typing it in
         * deliberately. That silent substitution is #1554.
         */
        design_estimated_cost:
          design?.estimated_cost === null || design?.estimated_cost === undefined
            ? null
            : Number(design.estimated_cost),
        design_production_cost:
          design?.production_cost === null ||
          design?.production_cost === undefined
            ? null
            : Number(design.production_cost),
        billed: billedRuns.get(String(run.id)) ?? null,
        /**
         * Live payouts against this design that never recorded a run.
         *
         * ⚠️ Non-empty means `billed: null` is IGNORANCE, not innocence — one
         * of these may already have paid for this very run. Read with
         * `billing_status` below rather than on its own.
         */
        unrecorded_claims:
          designsWithUnrecordedClaims.get(String(run.design_id)) ?? [],
        design_has_open_submission: designsWithOpenSubmission.has(
          String(run.design_id)
        ),
      }
    })
    .map((row) => ({
      ...row,
      /**
       * The single field a caller should branch on, so that "we don't know"
       * cannot be spelled the same way as "no".
       *
       * - `billed`  — a payment line names this run. Do not pay again.
       * - `unknown` — a live payout for this design records no run, so this
       *               run may already be inside it. Needs a human before it is
       *               paid; #1565 is the whole reason this value exists.
       * - `clear`   — every live payout for this design says which runs it
       *               covered, and none of them is this one. Safe to bill.
       */
      billing_status: row.billed
        ? ("billed" as const)
        : row.unrecorded_claims.length
          ? ("unknown" as const)
          : ("clear" as const),
    }))
    .sort((a, b) => {
      // Clear work first — that is what the screen is for. Then `unknown`,
      // which needs someone to establish what an old payout covered before any
      // money moves, then already-billed. Within a bucket: priced before
      // unpriced (those need a human to type a rate), then newest completion.
      //
      // 🔴 `unknown` deliberately does NOT rank with `clear`. Sorting an
      // unverifiable run to the top next to genuinely unpaid work is precisely
      // how a second payout for the same garments would get made.
      const rank = { clear: 0, unknown: 1, billed: 2 }
      if (rank[a.billing_status] !== rank[b.billing_status]) {
        return rank[a.billing_status] - rank[b.billing_status]
      }
      if (a.payable !== b.payable) return a.payable ? -1 : 1
      return (
        new Date(b.completed_at || 0).getTime() -
        new Date(a.completed_at || 0).getTime()
      )
    })

  return res.status(200).json({
    payable_runs,
    count: payable_runs.length,
  })
}
