/**
 * @route /admin/production-runs/:id/payments
 * @scope admin
 *
 * Whether this run has been billed, and by which payout (#1622).
 *
 * 🔴 The run does not know it has been billed. `payable-runs` computes exactly
 * this and drops it the moment its list is rendered, so the only place to learn
 * that a completed run was already paid for is a screen listing OTHER runs.
 * Anyone standing on the run itself sees nothing.
 *
 * The answer comes from `foldPartnerBilling`, the same fold `payable-runs` now
 * uses, so the two surfaces cannot disagree about who holds a run — and it is
 * scoped by PARTNER, not design, because a run-sourced line carries
 * `design_id: null` and a design-scoped query cannot see it (see `run-claims`).
 *
 * Response: { run_id, partner_id, billing_status, claim, unrecorded_claims, lines }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../modules/payment_submissions/service"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import { listPartnerSubmissionItems } from "../../../../../workflows/payment_submissions/lib/run-claims"
import {
  foldPartnerBilling,
  runBillableRemaining,
  runBillingStatus,
} from "../../../../../workflows/payment_submissions/lib/run-billing"
import { runBillableCeiling } from "../../../../../workflows/payment_submissions/lib/run-billable-ceiling"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const runService: any = req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = await runService.retrieveProductionRun(id).catch(() => null)

  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  /**
   * ⚠️ No partner means the claim is UNKNOWABLE, not absent. A claim lives on a
   * partner's submissions, so with no partner there is nowhere to look —
   * and answering "unbilled" would be absence read as permission, which is the
   * exact shape of #1557 and #1565. `unknown` already means "a human has to
   * establish this before money moves", which is the right instruction here.
   */
  if (!run.partner_id) {
    return res.status(200).json({
      run_id: id,
      partner_id: null,
      billing_status: "unknown",
      claim: null,
      billable_remaining: null,
      unrecorded_claims: [],
      lines: [],
    })
  }

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const priorItems = await listPartnerSubmissionItems(
    service as any,
    run.partner_id
  )

  const { billedRuns, designsWithUnrecordedClaims } =
    foldPartnerBilling(priorItems)

  const claim = billedRuns.get(String(id)) ?? null
  const unrecorded_claims = run.design_id
    ? designsWithUnrecordedClaims.get(String(run.design_id)) ?? []
    : []

  /**
   * Every line naming this run, not only the winning claim. A run billed on one
   * submission and rejected on another has a history worth seeing, and the fold
   * deliberately keeps only the first live claim.
   */
  const lines = (priorItems || [])
    .filter((item: any) =>
      ((item.production_run_ids || []) as string[]).includes(String(id))
    )
    .map((item: any) => ({
      submission_id: item.submission?.id ?? item.submission_id ?? null,
      submission_status: item.submission?.status ?? null,
      amount: item.amount ?? null,
      quantity: item.quantity ?? null,
      unit_amount: item.unit_amount ?? null,
      run_provenance: item.run_provenance ?? null,
      /** What `describePaymentLine` needs, so the badge uses the shared words. */
      source_type: item.source_type ?? null,
      design_id: item.design_id ?? null,
      design_name: item.design_name ?? null,
      task_id: item.task_id ?? null,
      task_name: item.task_name ?? null,
      inventory_order_id: item.inventory_order_id ?? null,
      inventory_order_name: item.inventory_order_name ?? null,
      order_id: item.order_id ?? null,
      production_run_ids: item.production_run_ids ?? null,
    }))

  /**
   * Units still billable on this run (#1596).
   *
   * 🔴 The CEILING, not the raw ordered quantity. Since the short close the two
   * are different numbers on a closed run, and this route was still reading
   * `run.quantity` — so the run page offered units the write guard refuses.
   * `retrieveProductionRun` returns the whole row, so `produced_quantity` and
   * `short_closed_at` are genuinely present rather than merely typed.
   */
  const billable_remaining = runBillableRemaining({
    claim,
    ordered: runBillableCeiling(run as any),
  })

  return res.status(200).json({
    run_id: id,
    partner_id: run.partner_id,
    /** Branch on this, never on `claim == null` — see `runBillingStatus`. */
    billing_status: runBillingStatus({
      billed: claim,
      unrecordedClaims: unrecorded_claims,
      remaining: billable_remaining,
      // #1676 — an open-ended run has no ceiling, so its remainder is null;
      // without this it would report `billed` after one claim and the run page
      // would say the work is fully paid for when more may still be billed.
      openEnded: run.quantity === null || run.quantity === undefined,
    }),
    /** #1676 — no agreed quantity. `billable_remaining` is null because there
     *  is no ceiling, NOT because nothing is left. */
    open_ended: run.quantity === null || run.quantity === undefined,
    claim,
    billable_remaining,
    unrecorded_claims,
    lines,
  })
}
