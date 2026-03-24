import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { signalLifecycleStepSuccessWorkflow } from "../../../../../workflows/production-runs/production-run-steps"
import { awaitRunFinishStepId } from "../../../../../workflows/production-runs/run-production-run-lifecycle"

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

  const id = req.params.id

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(id)
    .catch(() => null)

  if (!run || (run as any).partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  if ((run as any).status !== "in_progress") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Production run must be in_progress to finish. Current status: ${(run as any).status}`
    )
  }

  if (!(run as any).started_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Production run must be started before it can be finished"
    )
  }

  await productionRunService.updateProductionRuns({
    id: run.id,
    finished_at: new Date(),
  })

  // Signal the lifecycle workflow
  const transactionId = (run as any).metadata?.lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(req.scope)
      .run({
        input: {
          transaction_id: transactionId,
          step_id: awaitRunFinishStepId,
        },
      })
      .catch(() => {
        // No lifecycle workflow running — safe to ignore
      })
  }

  const updated = await productionRunService.retrieveProductionRun(id)

  return res.status(200).json({
    production_run: updated,
    message: "Production run finished",
  })
}
