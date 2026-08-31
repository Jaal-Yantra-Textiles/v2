import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { isProvenanceRun } from "../../../../workflows/consumption-logs/lib/reconcile-production-consumption"
import { runPayableOffer } from "../../../../workflows/production-runs/lib/run-payable"
import {
  foldPartnerBilling,
  runBillableRemaining,
  runBillingStatus,
} from "../../../../workflows/payment_submissions/lib/run-billing"
import { getPartnerFromAuthContext } from "../../helpers"
import { runBillableCeiling } from "../../../../workflows/payment_submissions/lib/run-billable-ceiling"

/**
 * GET /partners/payment-submissions/payable-runs
 *
 * The completed production runs this authenticated partner can bill for,
 * one row per RUN. Mirrors `GET /admin/payment-submissions/payable-runs`
 * but scoped to the authenticated partner's own runs.
 *
 * Same contract as the admin version: billing status, produced vs ordered,
 * rates agreed, and whether the run was already billed for in a prior payout.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<never>,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no actor ID"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no partner found"
    )
  }

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Completed runs of this partner
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: [
      "id",
      "design_id",
      "partner_id",
      "status",
      "quantity",
      "produced_quantity",
      // #1596 short-close. ⚠️ `runBillableCeiling` reads this; without it the
      // ceiling silently falls back to the ORDERED quantity and the screen
      // keeps offering units the write guard now refuses.
      "short_closed_at",
      "rejected_quantity",
      "partner_cost_estimate",
      "cost_type",
      "completed_at",
      // Read by `isProvenanceRun` — a guard reading a field the query never
      // fetched is dead code that types perfectly (#1606).
      "metadata",
    ],
    filters: { partner_id: partner.id, status: "completed" },
  })

  const designBackedRuns = ((runs || []) as any[]).filter((r) => !!r.design_id)

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
    return res
      .status(200)
      .json({ payable_runs: [], count: 0, excluded_runs, excluded_count: excluded_runs.length })
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

  // Prior payment lines for these designs, scoped to this partner's submissions
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const priorItems = (await service.listPaymentSubmissionItems(
    { design_id: designIds, submission: { partner_id: partner.id } },
    { relations: ["submission"] }
  )) as any[]

  /**
   * 🔴 This route used to carry its OWN copy of the fold — the second
   * implementation of "is this run billed" that `lib/run-billing` exists to
   * prevent, and it had already drifted: it never learned the quantity-aware
   * claim (#1596), so a run this partner had partly billed showed as fully
   * billed here while the admin screen and the write guard said otherwise.
   * One fold, used by both screens and the run page.
   */
  const { billedRuns, designsWithUnrecordedClaims, designsWithOpenSubmission } =
    foldPartnerBilling(priorItems as any[])

  const payable_runs = completedRuns
    .map((run) => {
      const design = designById.get(String(run.design_id))

      /**
       * 🔴 ONE pricer, shared with the admin screen and with `create`.
       *
       * This route used to price with its own arithmetic — `runUnitCost(run) ×
       * payable_quantity` — which is the derived rate re-multiplied, the exact
       * defect #1679 removed from the admin side. On a real run (₹10,000
       * agreed as a TOTAL, 9 ordered, 7 made) the two screens disagreed on the
       * same day: the admin offered ₹10,000 and this one ₹7,777.77, a 22% cut
       * nobody decided. Even when produced equalled ordered it lost a paisa
       * (₹9,999.99). A partner submitting their own draft under-claimed.
       *
       * `runPayableOffer` bills a `total` verbatim, multiplies a `per_unit`
       * rate, clamps the quantity at what was ordered (#1676), and says which
       * of its numbers was agreed via `unit_is_derived`.
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
        /**
         * ⚠️ `Number(null)` is 0, so a run with NO agreed quantity (#1676) used
         * to report `ordered_quantity: 0` — a run ordered for nothing, which is
         * a different and much worse statement than "no amount was agreed".
         * Read the raw field, not the coercion.
         */
        ordered_quantity:
          run.quantity === null || run.quantity === undefined
            ? null
            : Number.isFinite(ordered)
              ? ordered
              : null,
        produced_quantity: hasProduced ? produced : null,
        rejected_quantity:
          run.rejected_quantity === null || run.rejected_quantity === undefined
            ? null
            : Number(run.rejected_quantity),
        payable_quantity,
        quantity_basis: offer.quantity_basis,
        unit_amount,
        /**
         * ⚠️ Whether `unit_amount` was COMPUTED rather than agreed.
         *
         * True for every `cost_type: "total"` run — 97 of 100 on production.
         * A screen that multiplies it anyway bills a figure nobody agreed to.
         * The admin row has carried this since #1679; this one did not, which
         * is how the two screens came to disagree by 22%.
         */
        unit_is_derived: offer.unit_is_derived,
        amount: offer.amount,
        cost_type: run.cost_type ?? null,
        partner_cost_estimate:
          run.partner_cost_estimate === null ||
          run.partner_cost_estimate === undefined
            ? null
            : Number(run.partner_cost_estimate),
        payable: unit_amount > 0,
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
         * #1676 — the run states NO agreed quantity, so the offer is not
         * capped. Null `billable_remaining` beside this means "no ceiling",
         * not "nothing left".
         */
        open_ended: run.quantity === null || run.quantity === undefined,
        // Units still billable (#1596). Null when there is no arithmetic
        // behind the answer — which is exactly when `create` refuses.
        billable_remaining: runBillableRemaining({
          claim: billedRuns.get(String(run.id)),
          // #1596 — the CEILING, not the raw ordered quantity: a short-closed
          // run bills to what it produced, and this screen must offer exactly
          // what the write guard will accept.
          ordered: runBillableCeiling(run as any),
        }),
        unrecorded_claims:
          designsWithUnrecordedClaims.get(String(run.design_id)) ?? [],
        design_has_open_submission: designsWithOpenSubmission.has(
          String(run.design_id)
        ),
      }
    })
    .map((row) => ({
      ...row,
      billing_status: runBillingStatus({
        billed: row.billed,
        unrecordedClaims: row.unrecorded_claims,
        remaining: row.billable_remaining,
        // #1676 — without this an open-ended run reads as fully `billed` after
        // its first claim and this screen would never offer it again.
        openEnded: row.open_ended,
      }),
    }))
    .sort((a, b) => {
      // `partly_billed` ranks just behind `clear` — it is billable work.
      const rank = { clear: 0, partly_billed: 1, unknown: 2, billed: 3 }
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
  })
}
