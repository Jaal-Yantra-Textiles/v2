import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { adminAcceptProductionRunWorkflow } from "../../../../../workflows/production-runs/admin-accept-production-run"

/**
 * POST /admin/production-runs/:id/accept
 *
 * Admin-side accept of a production run on behalf of the assigned partner.
 * Mirrors POST /partners/production-runs/:id/accept but initiated by an
 * admin. The workflow retrieves the run, validates it is actionable, and
 * delegates to the existing `acceptProductionRunWorkflow` (policy gate,
 * status → in_progress, accepted_at, parent promotion, unified order
 * mirror) — then records an admin activity audit entry.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const { result, errors } = await adminAcceptProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      production_run_id: req.params.id,
      admin_actor_id: (req as any).auth_context?.actor_id ?? null,
    },
    throwOnError: false,
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to accept production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  const service: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const updated = await service.retrieveProductionRun(req.params.id)

  res.status(200).json({
    production_run: updated,
    message: "Production run accepted",
  })
}
