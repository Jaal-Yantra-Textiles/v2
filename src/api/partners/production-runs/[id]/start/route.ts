import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { signalLifecycleStepSuccessWorkflow } from "../../../../../workflows/production-runs/production-run-steps"
import { awaitRunStartStepId } from "../../../../../workflows/production-runs/run-production-run-lifecycle"

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
      `Production run must be in_progress to start. Current status: ${(run as any).status}`
    )
  }

  if ((run as any).started_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Production run has already been started"
    )
  }

  await productionRunService.updateProductionRuns({
    id: run.id,
    started_at: new Date(),
  })

  // Transition design status when production starts
  if ((run as any).design_id) {
    try {
      const designService = req.scope.resolve("design") as any
      const design = await designService.retrieveDesign((run as any).design_id)
      // Only transition if design is in a pre-production state
      const preProductionStatuses = ["Conceptual", "In_Development", "Technical_Review", "Approved", "Revision"]
      if (preProductionStatuses.includes(design.status)) {
        const newStatus = (run as any).run_type === "sample" ? "Sample_Production" : "In_Development"
        await designService.updateDesigns({
          id: (run as any).design_id,
          status: newStatus,
        })
      }
    } catch {
      // Non-fatal
    }
  }

  // Signal the lifecycle workflow
  const transactionId = (run as any).metadata?.lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(req.scope)
      .run({
        input: {
          transaction_id: transactionId,
          step_id: awaitRunStartStepId,
        },
      })
      .catch(() => {
        // No lifecycle workflow running — safe to ignore
      })
  }

  const updated = await productionRunService.retrieveProductionRun(id)

  // Emit event for notifications
  // Note: design.production_started is already emitted by send-production-run-to-production workflow
  // at dispatch time, so we only emit production_run.started here
  try {
    const { Modules } = await import("@medusajs/framework/utils")
    const eventService = req.scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{
      name: "production_run.started",
      data: { id, production_run_id: id, partner_id: partnerId, action: "started" },
    }])
  } catch { /* non-fatal */ }

  return res.status(200).json({
    production_run: updated,
    message: "Production run started",
  })
}
