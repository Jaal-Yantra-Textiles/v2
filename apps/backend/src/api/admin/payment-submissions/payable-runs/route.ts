import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { isProvenanceRun } from "../../../../workflows/consumption-logs/lib/reconcile-production-consumption"
import { runPayableOffer } from "../../../../workflows/production-runs/lib/run-payable"
import { listPartnerSubmissionItems } from "../../../../workflows/payment_submissions/lib/run-claims"
import { groupOrderBackedRuns } from "../../../../workflows/payment_submissions/lib/order-run-groups"
import { foldPartnerBilling } from "../../../../workflows/payment_submissions/lib/run-billing"

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
      // Needed to group the order-backed runs below, and to say which order a
      // row belongs to.
      "order_id",
      "product_id",
      "order_line_item_id",
      // Read by `isProvenanceRun` — a guard reading a field the query never
      // fetched is dead code that types perfectly (#1606).
      "metadata",
    ],
    filters: { partner_id: partnerId, status: "completed" },
  })

  const allRuns = (runs || []) as any[]
  const designBackedRuns = allRuns.filter((r) => !!r.design_id)

  /**
   * 🔴 Runs with no design were being dropped on the floor.
   *
   * `filter((r) => !!r.design_id)` was the first thing this endpoint did, and
   * everything downstream is design-keyed, so a run without one simply ceased
   * to exist here — no row, no exclusion, no count. The seven runs behind
   * retail order #79 are exactly that: minted by `order.fulfillment_created`
   * with `design_id: null`, completed, delivered, and never offered for payment
   * by any screen (#1598).
   *
   * That contradicted this file's own rule for the provenance runs directly
   * below — report what is held back and why, because "a screen that simply
   * omits the row teaches nobody why the work vanished". A silent drop is worse
   * than an exclusion: an exclusion at least says the work exists.
   *
   * These runs are real payable labour, so they are surfaced — grouped by the
   * ORDER that commissioned them, because that is the unit the payout is
   * agreed in. Order #79 is one payment of ₹8,974, not seven of ₹1,282.
   */
  const orderBackedRuns = allRuns.filter((r) => !r.design_id && !!r.order_id)

  /**
   * ⚠️ And runs with neither. Nothing can attribute these — no design to price
   * from, no order to group by. They are reported rather than dropped for the
   * same reason: an unattributable run is a data question someone must answer,
   * not a row to hide.
   */
  const unattributableRuns = allRuns.filter((r) => !r.design_id && !r.order_id)

  /**
   * Prior payment lines for this PARTNER.
   *
   * 🔴 Was scoped `{ design_id: designIds }`, on the reasoning that a run
   * belongs to one design so a prior billing of it could only sit on a line for
   * that design. That stopped being true when a line could be sourced from a
   * run or an inventory order (#1612): those carry `design_id: null` and were
   * invisible here, so a run this screen offers as payable could already have
   * been paid by a run-sourced line and the screen would never know.
   *
   * A run belongs to exactly one partner, so partner scope is equally exact and
   * equally bounded, and survives a line being keyed on something else. See
   * `workflows/payment_submissions/lib/run-claims`.
   *
   * Fetched BEFORE the design early-return below, because the order-backed rows
   * need it too and they must not disappear just because no design run exists.
   */
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const priorItems = await listPartnerSubmissionItems(service as any, partnerId)

  /** Run id → the live line claiming it. Rejected lines release their runs. */
  const claimedRunIds = new Map<string, { submission_id: string; status: string }>()
  for (const item of priorItems || []) {
    const status = String(item.submission?.status || "")
    if (status === "Rejected") continue
    for (const runId of (item.production_run_ids || []) as string[]) {
      if (!claimedRunIds.has(String(runId))) {
        claimedRunIds.set(String(runId), {
          submission_id: String(item.submission?.id || item.submission_id || ""),
          status,
        })
      }
    }
  }

  /**
   * Order-backed runs, grouped by the order that commissioned them.
   *
   * One group is one payout: the caller sends it to `POST
   * /admin/payment-submissions` as a single `run_lines` entry naming every run
   * id, which is why `run_ids` is given in full rather than a count.
   *
   * ⚠️ No `amount` is offered. These runs carry `partner_cost_estimate: null`
   * — all seven of order #79's do — so any figure here would be a 0 dressed up
   * as a price. The rate was agreed out of band and an operator must state it;
   * `create` refuses a zero-value run line for the same reason.
   */
  const order_runs = groupOrderBackedRuns(orderBackedRuns, claimedRunIds)

  const unattributable_runs = unattributableRuns.map((run) => ({
    run_id: String(run.id),
    completed_at: run.completed_at ?? null,
    excluded_reason: "no_design_and_no_order" as const,
  }))

  /**
   * A run minted by a retail fulfilment is not billable labour (#1606).
   *
   * `reconcile-provenance-runs` mints (or completes) a run when a design-backed
   * retail order ships from stock. It carries a partner, a design, a quantity and
   * `status: "completed"` — every filter this endpoint applies — but no
   * shop-floor work happened inside it and nothing was consumed. Offering it as
   * billable invents labour, exactly as counting it would invent material on the
   * consumption side, which is why `reconcileDesigns` has excluded these since
   * #1123. The money side never got the same treatment.
   *
   * 🔑 Reported rather than silently dropped. A partner DID make those goods —
   * just not in that run — and a screen that simply omits the row teaches nobody
   * why the work vanished. `excluded_runs` says which runs were held back and on
   * what grounds, and leaves the open product question (whether made-to-stock
   * work has any payout path at all) visible instead of buried.
   */
  const completedRuns = designBackedRuns.filter((r) => !isProvenanceRun(r))
  const excluded_runs = designBackedRuns
    .filter((r) => isProvenanceRun(r))
    .map((r) => ({
      run_id: String(r.id),
      design_id: String(r.design_id),
      completed_at: r.completed_at ?? null,
      excluded_reason: "provenance_run" as const,
    }))

  if (!completedRuns.length) {
    // ⚠️ Still returns the order-backed rows. They are not design-backed, so a
    // partner with no design runs at all can still have real payable work —
    // which is precisely the case this endpoint used to render as "nothing".
    return res.status(200).json({
      payable_runs: [],
      count: 0,
      excluded_runs,
      excluded_count: excluded_runs.length,
      order_runs,
      order_runs_count: order_runs.length,
      unattributable_runs,
    })
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

  /**
   * 🔴 The fold lives in `lib/run-billing.ts`, not here. #1622 asks the same
   * question from the run's own page, and a second copy of "is this run
   * billed" is how two screens start disagreeing about whether someone gets
   * paid twice. The rules — a Rejected submission releases its runs, the first
   * live claim wins, a `not_recorded` line is DOUBT rather than a clearance —
   * are stated there, once.
   */
  const { billedRuns, designsWithUnrecordedClaims, designsWithOpenSubmission } =
    foldPartnerBilling(priorItems as any[])

  const payable_runs = completedRuns
    .map((run) => {
      const design = designById.get(String(run.design_id))

      /**
       * 🔴 The offer comes from `runPayableOffer`, which `create` now prices
       * from too. These were two different pricers over one run: this screen
       * offered ₹810 and create wrote the design's ₹1,056.40 for the same run
       * (#1616). A figure an operator reads must be the figure that gets
       * written when they act on it.
       */
      const offer = runPayableOffer(run)
      const unit_amount = offer.unit_amount
      const payable_quantity = offer.quantity

      const produced = Number(run.produced_quantity)
      const hasProduced = Number.isFinite(produced) && produced > 0
      const ordered = Number(run.quantity)

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
        quantity_basis: offer.quantity_basis,
        unit_amount,
        /**
         * ⚠️ Whether `unit_amount` was COMPUTED rather than agreed (#1596).
         *
         * True for every `cost_type: "total"` run — 97 of 100 on production —
         * where the rate is `total / quantity` and `unit_amount * quantity`
         * deliberately does NOT reproduce `amount`. A screen showing "7 ×
         * ₹1,428.57" against a ₹10,000 line must say the rate is derived, or it
         * is presenting arithmetic as a negotiated price.
         */
        unit_is_derived: offer.unit_is_derived,
        amount: offer.amount,
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
    excluded_runs,
    excluded_count: excluded_runs.length,
    /**
     * Order-backed runs, as their own list rather than merged into
     * `payable_runs`. They are a different shape — no design, no per-unit rate,
     * grouped by order rather than one row per run — and folding them in would
     * hand every existing consumer rows whose `design_id` is null.
     */
    order_runs,
    order_runs_count: order_runs.length,
    unattributable_runs,
  })
}
