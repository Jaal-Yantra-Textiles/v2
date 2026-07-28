/**
 * @file Admin read-proxy: a partner's production runs (#843).
 * @module API/Admin/Partners/ProductionRuns
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listProductionRunsQuerySchema } from "../../../../partners/production-runs/validators"
import { listPartnerProductionRunsWorkflow } from "../../../../../workflows/production-runs/list-partner-production-runs"
import { resolvePartnerInspectionContext } from "../lib/partner-inspection"

/**
 * GET /admin/partners/:id/production-runs
 *
 * The inspection mirror of `GET /partners/production-runs`: same filters
 * (`status`, `role`, `run_type`, `design_id`), same field set, same
 * `unified_order_id` flattening — because it runs the same workflow, just with
 * the partner resolved from `:id` instead of from a partner bearer.
 *
 * Note this is scoped by the run's own `partner_id`, so it answers "what is
 * this partner on the hook for", which is the question an operator chasing a
 * late run actually has. Runs the partner merely *depends* on are out of scope
 * here, exactly as they are on the partner side.
 *
 * READ-ONLY. Accept/start/finish/complete stay on the partner routes — moving a
 * run on a partner's behalf is the audited impersonation track (approach #1).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  // Parsed against the partner schema itself so the two surfaces share one
  // query contract rather than two that can drift.
  const { limit = 20, offset = 0, status, role, run_type, design_id } =
    listProductionRunsQuerySchema.parse(
      (req.query as Record<string, unknown>) || {}
    )

  const { partner } = await resolvePartnerInspectionContext(partnerId, req.scope)

  const { result } = await listPartnerProductionRunsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      status,
      role,
      run_type,
      design_id,
      offset,
      limit,
      locale: req.locale,
    },
  })

  res.json(result)
}
