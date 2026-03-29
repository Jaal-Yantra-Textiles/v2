import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService, Logger } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"
import {
  sendProductionRunToProductionWorkflow,
} from "../workflows/production-runs/send-production-run-to-production"

export default async function productionRunTaskUpdatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["id", "title", "status", "metadata"],
      filters: { id: data.id },
    })

    const task = (taskData || [])[0] as any
    const productionRunId = task?.metadata?.production_run_id

    if (!productionRunId) {
      return
    }

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService
      .retrieveProductionRun(String(productionRunId))
      .catch(() => null)

    if (!run) {
      return
    }

    const currentStatus = String((run as any).status)

    if (["completed", "cancelled"].includes(currentStatus)) {
      return
    }

    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: ["id", "status", "parent_run_id", "design_id", "partner_id", "run_type", "tasks.*"],
      filters: { id: String(productionRunId) },
      pagination: { skip: 0, take: 1 },
    })

    const node = (runs || [])[0] as any
    const linkedTasks = (node?.tasks || []) as any[]

    const containerTitle = `production-run-${String(productionRunId)}`
    const relevantTasks = linkedTasks.filter((t) => {
      if (!t?.id) {
        return false
      }

      if (String(t.title || "") === containerTitle) {
        return false
      }

      return true
    })

    if (!relevantTasks.length) {
      return
    }

    const allCompleted = relevantTasks.every(
      (t) => String(t?.status || "") === "completed"
    )

    if (!allCompleted) {
      return
    }

    // Use locking to prevent race conditions when multiple tasks complete
    // simultaneously or when the partner /complete route fires at the same time
    const lockingService = container.resolve(Modules.LOCKING) as any
    const lockKey = `production-run-complete:${String(productionRunId)}`

    await lockingService.execute(lockKey, async () => {
      // Re-check status inside the lock to guard against concurrent writes
      const freshRun = await productionRunService
        .retrieveProductionRun(String(productionRunId))
        .catch(() => null)

      if (!freshRun || ["completed", "cancelled"].includes(String((freshRun as any).status))) {
        return
      }

      await productionRunService.updateProductionRuns({
        id: String(productionRunId),
        status: "completed" as any,
        completed_at: new Date(),
      })
    })

    // Emit production_run.completed so downstream subscribers fire
    // (e.g. sample-run-completed for cost calculation)
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    try {
      const designId = (node as any)?.design_id ?? (run as any)?.design_id
      await eventBus.emit([
        {
          name: "production_run.completed",
          data: {
            id: String(productionRunId),
            production_run_id: String(productionRunId),
            partner_id: (node as any)?.partner_id ?? (run as any)?.partner_id ?? null,
            action: "completed",
          },
        },
        ...(designId
          ? [
              {
                name: "design.production_completed",
                data: {
                  design_id: String(designId),
                  production_run_id: String(productionRunId),
                },
              },
            ]
          : []),
      ])
    } catch (e: any) {
      logger.warn(
        `[tasks.task.updated] Failed to emit completion events: ${e?.message || String(e)}`
      )
    }

    const parentRunId = (node as any)?.parent_run_id ?? null
    if (!parentRunId) {
      return
    }

    // Auto-dispatch sibling runs that depend on this now-completed run
    try {
      const siblings = await productionRunService.listProductionRuns({
        parent_run_id: String(parentRunId),
      } as any)

      for (const sibling of siblings || []) {
        const depIds = (sibling as any).depends_on_run_ids as string[] | null
        if (!depIds?.length) continue
        if (!depIds.includes(String(productionRunId))) continue
        if (String((sibling as any).status) !== "approved") continue

        // Check if ALL dependencies are completed
        const depRuns = await Promise.all(
          depIds.map((id) =>
            productionRunService.retrieveProductionRun(id).catch(() => null)
          )
        )
        const allDepsCompleted = depRuns.every(
          (r) => r && String((r as any).status) === "completed"
        )

        if (!allDepsCompleted) continue

        // Auto-dispatch: use template_names from metadata if available
        const templateNames = ((sibling as any).dispatch_template_names ?? (sibling as any)?.metadata?.dispatch_template_names) as string[] | undefined

        if (templateNames?.length) {
          logger.info(
            `[tasks.task.updated] Auto-dispatching dependent run ${(sibling as any).id} with templates: ${templateNames.join(", ")}`
          )
          await sendProductionRunToProductionWorkflow(container).run({
            input: {
              production_run_id: String((sibling as any).id),
              template_names: templateNames,
            },
          })
        } else {
          logger.info(
            `[tasks.task.updated] Dependent run ${(sibling as any).id} is ready for dispatch but has no pre-configured templates. Manual dispatch required.`
          )
        }
      }
    } catch (e: any) {
      logger.warn(
        `[tasks.task.updated] Failed to auto-dispatch dependent runs: ${e?.message || String(e)}`
      )
    }

    // Cascade: mark parent completed if all children are done
    const parentLockKey = `production-run-complete:${String(parentRunId)}`

    await lockingService.execute(parentLockKey, async () => {
      const children = await productionRunService.listProductionRuns({
        parent_run_id: String(parentRunId),
      } as any)

      if (!children?.length) {
        return
      }

      const allChildrenCompleted = (children || []).every(
        (c: any) => String(c?.status || "") === "completed"
      )

      if (!allChildrenCompleted) {
        return
      }

      const parent = await productionRunService
        .retrieveProductionRun(String(parentRunId))
        .catch(() => null)

      if (!parent) {
        return
      }

      const parentStatus = String((parent as any).status)
      if (["completed", "cancelled"].includes(parentStatus)) {
        return
      }

      await productionRunService.updateProductionRuns({
        id: String(parentRunId),
        status: "completed" as any,
        completed_at: new Date(),
      })
    })
  } catch (e: any) {
    logger.warn(
      `[tasks.task.updated] Failed to update production run status: ${
        e?.message || String(e)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "tasks.task.updated",
}
