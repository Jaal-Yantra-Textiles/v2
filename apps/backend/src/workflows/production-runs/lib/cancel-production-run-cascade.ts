import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { logger } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { TASKS_MODULE } from "../../../modules/tasks"
import { mirrorRunStatusToUnifiedOrder } from "../dual-write-unified-run-order"

/**
 * Cancelling a run, in ONE place.
 *
 * Lifted verbatim out of `POST /admin/production-runs/:id/cancel` when the
 * #1574 inactivity sweep needed the same behaviour. Cancelling touches the run,
 * its tasks, its children, its parent, the unified order mirror AND the
 * notification event — six things, in an order that matters. A second
 * implementation would have drifted from this one the first time any of the six
 * changed, and the drift would show up as a partner not being told their work
 * was called off.
 */

export type CancelRunResult = {
  run: any
  cancelled_children: string[]
  skipped?: "already_cancelled" | "completed"
}

/** Cancel one run and its tasks. Terminal runs are left untouched. */
export const cancelSingleRun = async (
  container: any,
  runId: string,
  reason: string
): Promise<{ run: any; skipped: boolean }> => {
  const productionRunService: ProductionRunService = container.resolve(
    PRODUCTION_RUNS_MODULE
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const taskService = container.resolve(TASKS_MODULE) as any

  const run = (await productionRunService.retrieveProductionRun(runId)) as any

  if (run.status === "cancelled") return { run, skipped: true }
  if (run.status === "completed") return { run, skipped: true }

  await productionRunService.updateProductionRuns({
    id: runId,
    status: "cancelled",
    cancelled_at: new Date(),
    cancelled_reason: reason,
  })

  try {
    const { data: runData } = await query.graph({
      entity: "production_runs",
      fields: ["tasks.id", "tasks.status"],
      filters: { id: runId },
    })
    const tasks = runData?.[0]?.tasks || []

    for (const task of tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        await taskService.updateTasks({ id: task.id, status: "cancelled" })
      }
    }
  } catch (e: any) {
    logger.error(
      `[cancel-production-run] Failed to cancel tasks for ${runId}: ${e.message}`
    )
  }

  const updated = await productionRunService.retrieveProductionRun(runId)
  return { run: updated, skipped: false }
}

/**
 * Cancel a run, its children, and its parent when every sibling is terminal —
 * then mirror onto the unified orders and emit `production_run.cancelled`.
 *
 * 🔑 The event is what tells anybody. `production-run-partner-email` emails the
 * owning partner's admins off it, and `production-run-notifications` writes the
 * admin feed entry — both keyed on `production_run.cancelled`, and both read
 * `notes` for the reason. A cancel that skipped the emit would be silent to
 * everyone it affects.
 *
 * `eventData` rides along into that payload. The inactivity sweep uses it to
 * carry how long the run was actually idle, so the partner's email can say "no
 * activity for 81 days" rather than restating the 28-day rule at them (#1574).
 * An admin cancel passes nothing and the mail renders exactly as before.
 */
export const cancelProductionRunCascade = async (
  container: any,
  runId: string,
  reason: string,
  eventData?: Record<string, unknown>
): Promise<CancelRunResult> => {
  const productionRunService: ProductionRunService = container.resolve(
    PRODUCTION_RUNS_MODULE
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  const run = (await productionRunService.retrieveProductionRun(runId)) as any

  if (run.status === "cancelled") {
    return { run, cancelled_children: [], skipped: "already_cancelled" }
  }
  if (run.status === "completed") {
    return { run, cancelled_children: [], skipped: "completed" }
  }

  await cancelSingleRun(container, runId, reason)

  const cancelledChildren: string[] = []
  try {
    const { data: children } = await query.graph({
      entity: "production_runs",
      fields: ["id", "status"],
      filters: {
        parent_run_id: runId,
        status: { $nin: ["completed", "cancelled"] },
      },
    })

    for (const child of children || []) {
      const { skipped } = await cancelSingleRun(
        container,
        child.id,
        "Parent run cancelled"
      )
      if (!skipped) cancelledChildren.push(child.id)
    }
  } catch (e: any) {
    logger.error(
      `[cancel-production-run] Failed to cancel children: ${e.message}`
    )
  }

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
        const parent = (await productionRunService.retrieveProductionRun(
          run.parent_run_id
        )) as any
        if (
          parent &&
          !["cancelled", "completed"].includes(String(parent.status))
        ) {
          await productionRunService.updateProductionRuns({
            id: run.parent_run_id,
            status: "cancelled",
            cancelled_at: new Date(),
            cancelled_reason: "All child runs cancelled",
          })
        }
      }
    } catch (e: any) {
      logger.error(
        `[cancel-production-run] Failed to check/cancel parent: ${e.message}`
      )
    }
  }

  // #342 / #1574 — the mirror now carries a partner_status of `cancelled`, so
  // the order stops rendering as live work.
  for (const id of [runId, ...cancelledChildren, run.parent_run_id].filter(
    Boolean
  )) {
    await mirrorRunStatusToUnifiedOrder(container, id as string)
  }

  try {
    const eventService = container.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([
      {
        name: "production_run.cancelled",
        data: {
          id: runId,
          production_run_id: runId,
          action: "cancelled",
          notes: reason,
          ...(eventData || {}),
        },
      },
    ])
  } catch {
    /* non-fatal */
  }

  const final = await productionRunService.retrieveProductionRun(runId)
  return { run: final, cancelled_children: cancelledChildren }
}
