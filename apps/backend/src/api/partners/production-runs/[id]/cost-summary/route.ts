/**
 * @file Partner production-run cost summary
 * @description Roadmap #6 Phase 5 — parity with the admin
 * `/admin/production-runs/:id/cost-summary`, scoped to the partner that
 * owns the run (or is the outsourced sub-partner on it). Reuses the
 * shared `computeRunCostSummary` so the numbers match admin exactly.
 * @module API/Partners/ProductionRuns/CostSummary
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { computeRunCostSummary } from "../../../../../modules/production_runs/cost-summary"

export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const { id } = req.params
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  // Scope: the run must belong to this partner — either as the
  // originator (partner_id) or the outsourced executor (sub_partner_id).
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "production_runs",
    filters: { id },
    fields: ["id", "partner_id", "sub_partner_id"],
  })
  const run = (data || [])[0] as any
  if (
    !run ||
    (run.partner_id !== partnerId && run.sub_partner_id !== partnerId)
  ) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found for this partner`
    )
  }

  const cost_summary = await computeRunCostSummary(req.scope, id)
  res.status(200).json({ cost_summary })
}
