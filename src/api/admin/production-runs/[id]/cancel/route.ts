import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { TASKS_MODULE } from "../../../../../modules/tasks"

/**
 * POST /admin/production-runs/:id/cancel
 *
 * Cancels a production run and its associated tasks.
 * - Sets run status to "cancelled"
 * - Cancels all linked tasks
 * - Also cancels child runs if this is a parent run
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const productionRunService: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  // Fetch the run
  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(id)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found")
  }

  if (run.status === "cancelled") {
    return res.json({ production_run: run, message: "Already cancelled" })
  }

  if (run.status === "completed") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot cancel a completed production run"
    )
  }

  // Cancel the run
  await productionRunService.updateProductionRuns({
    id,
    status: "cancelled",
    metadata: {
      ...(run.metadata || {}),
      cancelled_at: new Date().toISOString(),
      cancelled_reason: (req.body as any)?.reason || "Admin cancelled",
    },
  })

  // Cancel linked tasks
  try {
    const { data: runData } = await query.graph({
      entity: "production_runs",
      fields: ["tasks.id", "tasks.status"],
      filters: { id },
    })
    const tasks = runData?.[0]?.tasks || []
    const taskService = req.scope.resolve(TASKS_MODULE) as any

    for (const task of tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        await taskService.updateTasks({
          id: task.id,
          status: "cancelled",
        })
      }
    }
  } catch (e: any) {
    console.error("[cancel-production-run] Failed to cancel tasks:", e.message)
  }

  // Cancel child runs if this is a parent
  try {
    const { data: children } = await query.graph({
      entity: "production_runs",
      fields: ["id", "status"],
      filters: { parent_run_id: id, status: { $nin: ["completed", "cancelled"] } },
    })

    for (const child of children || []) {
      await productionRunService.updateProductionRuns({
        id: child.id,
        status: "cancelled",
        metadata: {
          cancelled_at: new Date().toISOString(),
          cancelled_reason: "Parent run cancelled",
        },
      })
    }
  } catch (e: any) {
    console.error("[cancel-production-run] Failed to cancel children:", e.message)
  }

  const updated = await productionRunService.retrieveProductionRun(id)
  res.json({ production_run: updated, message: "Production run cancelled" })
}
