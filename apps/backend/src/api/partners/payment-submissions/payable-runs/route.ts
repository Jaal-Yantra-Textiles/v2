import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { isProvenanceRun } from "../../../../workflows/consumption-logs/lib/reconcile-production-consumption"
import { runUnitCost } from "../../../../workflows/production-runs/lib/run-payable"
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

      const unit_amount = runUnitCost(run)

      const produced = Number(run.produced_quantity)
      const hasProduced = Number.isFinite(produced) && produced > 0
      const ordered = Number(run.quantity)
      const hasOrdered = Number.isFinite(ordered) && ordered > 0
      const offered = hasProduced ? produced : hasOrdered ? ordered : 1
      /**
       * 🔴 Never more than was ORDERED (#1676). The write guard refuses a claim
       * above the run's agreed quantity — including the run's FIRST claim — so
       * offering the raw produced figure would put a number on the partner's
       * screen that `create` then rejects. A run with no agreed quantity has no
       * `ordered` to clamp against, and offers what was made.
       *
       * ⚠️ This route prices with its OWN arithmetic (`runUnitCost` x quantity)
       * rather than `runPayableOffer`, which the admin screen and `create` both
       * use. That divergence predates this change and is the shape of #1679 —
       * a derived rate re-multiplied — sitting on the partner screen. The clamp
       * is duplicated here rather than left out; unifying the pricer is its own
       * change.
       */
      const payable_quantity = hasOrdered
        ? Math.min(offered, ordered)
        : offered

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
        // Honest about the clamp: a produced figure cut back to ordered IS
        // ordered — the same rule `runPayableOffer` applies.
        quantity_basis:
          hasProduced && payable_quantity === produced ? "produced" : "ordered",
        unit_amount,
        amount: Math.round(unit_amount * payable_quantity * 100) / 100,
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
