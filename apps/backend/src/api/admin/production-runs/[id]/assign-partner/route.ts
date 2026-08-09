/**
 * @file Admin API route for manually assigning a partner to a production run
 * @module API/Admin/ProductionRuns
 */

/**
 * Assign (or re-assign) a production run to a partner.
 *
 * #1228 — the manual counterpart to #1093's automatic reassignment. When a run
 * is parked in `awaiting_reassignment` (reminder cap reached, or the partner
 * declined) this is the only way back out. `partner_id` may be the same partner
 * who let it lapse — "send it to them again" — or a different one.
 *
 * The run lands on `approved`, NOT `sent_to_partner`: dispatch is what collects
 * template names, and template names are what seed the partner's tasks. The
 * operator's next step is the ordinary Dispatch action.
 *
 * @route POST /admin/production-runs/:id/assign-partner
 * @param {string} id.path.required - The production run id
 * @param {AdminAssignProductionRunPartnerReq} request.body.required - { partner_id, note? }
 * @returns {Object} 200 - { production_run, previous_partner_id, same_partner }
 * @throws {MedusaError} 404 - Production run or partner not found
 * @throws {MedusaError} 400 - Run already accepted, terminal, or in a status the policy disallows
 *
 * @example request
 * POST /admin/production-runs/prod_run_123/assign-partner
 * { "partner_id": "part_456", "note": "Called them, they'll take it this time" }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { assignProductionRunPartnerWorkflow } from "../../../../../workflows/production-runs/assign-production-run-partner"
import type { AdminAssignProductionRunPartnerReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminAssignProductionRunPartnerReq>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const body = (req.validatedBody || req.body) as AdminAssignProductionRunPartnerReq

  const { result } = await assignProductionRunPartnerWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      partner_id: body.partner_id,
      note: body.note ?? null,
      source: "manual",
    },
  })

  const productionRunService: ProductionRunService = req.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )
  const production_run = await productionRunService.retrieveProductionRun(id)

  return res.status(200).json({
    production_run,
    previous_partner_id: result.previous_partner_id,
    same_partner: result.same_partner,
  })
}
