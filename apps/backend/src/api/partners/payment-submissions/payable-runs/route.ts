import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { runUnitCost } from "../../../../workflows/production-runs/lib/run-payable"
import { getPartnerFromAuthContext } from "../../helpers"

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
      "rejected_quantity",
      "partner_cost_estimate",
      "cost_type",
      "completed_at",
    ],
    filters: { partner_id: partner.id, status: "completed" },
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

  // Prior payment lines for these designs, scoped to this partner's submissions
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const priorItems = (await service.listPaymentSubmissionItems(
    { design_id: designIds, submission: { partner_id: partner.id } },
    { relations: ["submission"] }
  )) as any[]

  const billedRuns = new Map<
    string,
    { submission_id: string; status: string; quantity: number }
  >()
  const designsWithOpenSubmission = new Set<string>()
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
        unrecorded_claims:
          designsWithUnrecordedClaims.get(String(run.design_id)) ?? [],
        design_has_open_submission: designsWithOpenSubmission.has(
          String(run.design_id)
        ),
      }
    })
    .map((row) => ({
      ...row,
      billing_status: row.billed
        ? ("billed" as const)
        : row.unrecorded_claims.length
          ? ("unknown" as const)
          : ("clear" as const),
    }))
    .sort((a, b) => {
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
