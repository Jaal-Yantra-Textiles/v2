import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { signalLifecycleStepSuccessWorkflow } from "../../../../../workflows/production-runs/production-run-steps"
import { awaitRunFinishStepId } from "../../../../../workflows/production-runs/run-production-run-lifecycle"

const FinishBodySchema = z.object({
  notes: z.string().optional(),
}).optional()

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

  // Parse optional notes
  const parsed = FinishBodySchema.safeParse(
    (req as any).validatedBody || req.body
  )
  const notes = parsed?.success && parsed.data ? parsed.data.notes : undefined

  await productionRunService.updateProductionRuns({
    id: run.id,
    finished_at: new Date(),
    ...(notes ? { finish_notes: notes } : {}),
  })

  // Move design to Revision — partner finished, needs admin review
  if ((run as any).design_id) {
    try {
      const designService = req.scope.resolve("design") as any
      const design = await designService.retrieveDesign((run as any).design_id)
      const skipStatuses = ["Approved", "Commerce_Ready", "Rejected", "Superseded"]
      if (!skipStatuses.includes(design.status)) {
        await designService.updateDesigns({
          id: (run as any).design_id,
          status: "Revision",
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
          step_id: awaitRunFinishStepId,
        },
      })
      .catch(() => {
        // No lifecycle workflow running — safe to ignore
      })
  }

  const updated = await productionRunService.retrieveProductionRun(id)

  // Emit event for notifications
  try {
    const { Modules } = await import("@medusajs/framework/utils")
    const eventService = req.scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{
      name: "production_run.finished",
      data: { id, production_run_id: id, partner_id: partnerId, action: "finished", notes },
    }])
  } catch { /* non-fatal */ }

  return res.status(200).json({
    production_run: updated,
    message: "Production run finished",
  })
}
