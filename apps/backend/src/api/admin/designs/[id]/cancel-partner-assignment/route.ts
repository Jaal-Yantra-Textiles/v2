import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import { TASKS_MODULE } from "../../../../../modules/tasks"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import { cancelWorkflowTransactionWorkflow } from "../../../../../workflows/designs/design-steps"

const V1_TASK_TITLES = [
  "partner-design-start",
  "partner-design-redo",
  "partner-design-finish",
  "partner-design-completed",
]

/**
 * POST /admin/designs/:id/cancel-partner-assignment
 *
 * Cancels the v1 send-to-partner workflow for a design by:
 * 1. Finding the workflow transaction ID from linked tasks
 * 2. Cancelling the long-running workflow transaction (marks all pending steps as failed)
 * 3. Cancelling all v1 partner-workflow tasks
 * 4. Resetting design metadata (partner_status, partner_phase, etc.)
 * 5. Optionally unlinking the partner
 *
 * Body: { partner_id: string, unlink?: boolean }
 *
 * After cancellation, the design can be re-assigned via a production run.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const designId = req.params.id
  const { partner_id, unlink = false } = (req.body || {}) as {
    partner_id?: string
    unlink?: boolean
  }

  if (!partner_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  // Verify the design exists and fetch its tasks
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "name", "status", "metadata", "tasks.*", "partners.id"],
  })

  const design = designs?.[0]
  if (!design) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found")
  }

  const isLinked = (design.partners || []).some((p: any) => p.id === partner_id)
  if (!isLinked) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner is not linked to this design"
    )
  }

  // Find v1 workflow tasks and extract the transaction ID
  const v1Tasks = (design.tasks || []).filter(
    (t: any) => V1_TASK_TITLES.includes(t.title)
  )

  let transactionId: string | null = null
  for (const task of v1Tasks) {
    if (task.transaction_id) {
      transactionId = task.transaction_id
      break
    }
  }

  // Step 1: Cancel the workflow transaction (marks all pending async steps as failed)
  if (transactionId) {
    try {
      await cancelWorkflowTransactionWorkflow(req.scope).run({
        input: {
          transactionId,
          updatedDesign: { id: designId },
        },
      })
    } catch (e: any) {
      // Log but continue — the workflow may already be in a terminal state
      console.warn(
        "[cancel-partner-assignment] Workflow cancellation warning:",
        e.message
      )
    }
  }

  // Step 2: Cancel all v1 tasks
  const cancelledTaskIds: string[] = []
  if (v1Tasks.length > 0) {
    const taskService = req.scope.resolve(TASKS_MODULE) as any

    for (const task of v1Tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        try {
          await taskService.updateTasks({
            id: task.id,
            status: "cancelled",
          })
          cancelledTaskIds.push(task.id)
        } catch (e: any) {
          console.error(
            `[cancel-partner-assignment] Failed to cancel task ${task.id}:`,
            e.message
          )
        }
      }
    }
  }

  // Step 2.5: Cancel the partner's active production runs for this design.
  // Cancelling the assignment must also cancel the work — otherwise a
  // non-terminal run lingers that the partner can still drive to
  // completion via the v2 /partners/production-runs endpoints (which only
  // guard on the run's own status). Terminal runs (completed/cancelled)
  // are left as-is.
  const cancelledRunIds: string[] = []
  try {
    const productionRunService = req.scope.resolve(
      PRODUCTION_RUNS_MODULE
    ) as any
    const taskService = req.scope.resolve(TASKS_MODULE) as any
    const { data: runs } = await query.graph({
      entity: "production_runs",
      filters: {
        design_id: designId,
        partner_id,
        status: { $nin: ["completed", "cancelled"] },
      },
      fields: ["id", "status"],
    })
    for (const run of runs || []) {
      await productionRunService.updateProductionRuns({
        id: run.id,
        status: "cancelled",
        cancelled_at: new Date(),
        cancelled_reason: "partner_assignment_cancelled",
      })
      cancelledRunIds.push(run.id)
      // Cancel the run's non-terminal tasks too
      try {
        const { data: runData } = await query.graph({
          entity: "production_runs",
          fields: ["tasks.id", "tasks.status"],
          filters: { id: run.id },
        })
        for (const task of runData?.[0]?.tasks || []) {
          if (task.status !== "completed" && task.status !== "cancelled") {
            await taskService.updateTasks({ id: task.id, status: "cancelled" })
          }
        }
      } catch (e: any) {
        console.error(
          `[cancel-partner-assignment] Failed to cancel tasks for run ${run.id}:`,
          e.message
        )
      }
    }
  } catch (e: any) {
    console.error(
      "[cancel-partner-assignment] Failed to cancel production runs:",
      e.message
    )
  }

  // Step 3: Reset design metadata via service directly (workflow merge preserves old keys)
  try {
    const designService = req.scope.resolve(DESIGN_MODULE) as any
    const cleanMeta = { ...(design.metadata || {}) }
    delete cleanMeta.partner_status
    delete cleanMeta.partner_phase
    delete cleanMeta.partner_started_at
    delete cleanMeta.partner_finished_at
    delete cleanMeta.partner_completed_at
    cleanMeta.partner_assignment_cancelled_at = new Date().toISOString()
    cleanMeta.partner_assignment_cancelled_partner_id = partner_id

    await designService.updateDesigns({
      id: designId,
      metadata: cleanMeta,
    })
  } catch (e: any) {
    console.error("[cancel-partner-assignment] Failed to reset metadata:", e.message)
  }

  // Step 4: Optionally unlink the partner
  if (unlink) {
    try {
      await remoteLink.dismiss({
        [DESIGN_MODULE]: { design_id: designId },
        [PARTNER_MODULE]: { partner_id },
      })
    } catch (e: any) {
      console.error("[cancel-partner-assignment] Failed to unlink partner:", e.message)
    }
  }

  res.json({
    design_id: designId,
    partner_id,
    transaction_id: transactionId,
    cancelled_tasks: cancelledTaskIds.length,
    cancelled_runs: cancelledRunIds.length,
    unlinked: unlink,
    message: `Partner assignment cancelled.${transactionId ? ` Workflow transaction ${transactionId} cancelled.` : ""} ${cancelledTaskIds.length} task(s) cancelled.${cancelledRunIds.length ? ` ${cancelledRunIds.length} run(s) cancelled.` : ""}${unlink ? " Partner unlinked." : " Partner still linked — ready for production run."}`,
  })
}
