import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { startProductionRunWorkflow } from "../../../../../workflows/production-runs/start-production-run"

export async function POST(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  const { result, errors } = await startProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: req.params.id,
      partner_id: partnerId,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to start production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  // Re-fetch to return latest state
  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const updated = await productionRunService.retrieveProductionRun(req.params.id)

  return res.status(200).json({
    production_run: updated,
    message: "Production run started",
  })
}
