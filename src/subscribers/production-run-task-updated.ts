import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"

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
      fields: ["id", "status", "parent_run_id", "tasks.*"],
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

    await productionRunService.updateProductionRuns({
      id: String(productionRunId),
      status: "completed" as any,
    })

    const parentRunId = (node as any)?.parent_run_id ?? null
    if (!parentRunId) {
      return
    }

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
