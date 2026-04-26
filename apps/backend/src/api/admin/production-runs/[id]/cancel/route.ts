import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { TASKS_MODULE } from "../../../../../modules/tasks"

/**
 * Cancel a single run: update status, cancel tasks.
 */
async function cancelSingleRun(
  runId: string,
  reason: string,
  productionRunService: ProductionRunService,
  query: any,
  taskService: any
) {
  const run = await productionRunService.retrieveProductionRun(runId) as any

  if (run.status === "cancelled") return { run, skipped: true }
  if (run.status === "completed") return { run, skipped: true }

  await productionRunService.updateProductionRuns({
    id: runId,
    status: "cancelled",
    cancelled_at: new Date(),
    cancelled_reason: reason,
  })

  // Cancel linked tasks
  try {
    const { data: runData } = await query.graph({
      entity: "production_runs",
      fields: ["tasks.id", "tasks.status"],
      filters: { id: runId },
    })
    const tasks = runData?.[0]?.tasks || []

    for (const task of tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        await taskService.updateTasks({
          id: task.id,
          status: "cancelled",
        })
      }
    }
  } catch (e: any) {
    console.error(`[cancel-production-run] Failed to cancel tasks for ${runId}:`, e.message)
  }

  const updated = await productionRunService.retrieveProductionRun(runId)
  return { run: updated, skipped: false }
}

/**
 * POST /admin/production-runs/:id/cancel
 *
 * Cancels a production run and its associated tasks.
 * - Sets run status to "cancelled"
 * - Cancels all linked tasks for the run and its children
 * - Also cancels child runs if this is a parent run
 * - If cancelling a child run, checks if all siblings are now terminal
 *   and cancels the parent if so
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const productionRunService: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const taskService = req.scope.resolve(TASKS_MODULE) as any
  const reason = (req.body as any)?.reason || "Admin cancelled"

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

  // Cancel the target run + its tasks
  const { run: updatedRun } = await cancelSingleRun(
    id, reason, productionRunService, query, taskService
  )

  // Cancel all child runs (if this is a parent)
  const cancelledChildren: string[] = []
  try {
    const { data: children } = await query.graph({
      entity: "production_runs",
      fields: ["id", "status"],
      filters: { parent_run_id: id, status: { $nin: ["completed", "cancelled"] } },
    })

    for (const child of children || []) {
      const { skipped } = await cancelSingleRun(
        child.id, "Parent run cancelled", productionRunService, query, taskService
      )
      if (!skipped) cancelledChildren.push(child.id)
    }
  } catch (e: any) {
    console.error("[cancel-production-run] Failed to cancel children:", e.message)
  }

  // If this is a child run, check if all siblings are now terminal → cancel parent
  if (run.parent_run_id) {
    try {
      const { data: siblings } = await query.graph({
        entity: "production_runs",
        fields: ["id", "status"],
        filters: { parent_run_id: run.parent_run_id },
      })

      const allTerminal = (siblings || []).every(
        (s: any) => s.status === "cancelled" || s.status === "completed"
      )

      if (allTerminal) {
        const parent = await productionRunService.retrieveProductionRun(run.parent_run_id) as any
        if (parent.status !== "cancelled" && parent.status !== "completed") {
          await productionRunService.updateProductionRuns({
            id: run.parent_run_id,
            status: "cancelled",
            cancelled_at: new Date(),
            cancelled_reason: "All child runs cancelled",
          })
        }
      }
    } catch (e: any) {
      console.error("[cancel-production-run] Failed to check/cancel parent:", e.message)
    }
  }

  // Emit event for notifications
  try {
    const { Modules } = await import("@medusajs/framework/utils")
    const eventService = req.scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{
      name: "production_run.cancelled",
      data: { id, production_run_id: id, action: "cancelled", notes: reason },
    }])
  } catch { /* non-fatal */ }

  const final = await productionRunService.retrieveProductionRun(id)
  res.json({
    production_run: final,
    cancelled_children: cancelledChildren,
    message: `Production run cancelled${cancelledChildren.length ? `. ${cancelledChildren.length} child run(s) also cancelled.` : "."}`,
  })
}
