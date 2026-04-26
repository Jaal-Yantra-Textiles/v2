import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { TASKS_MODULE } from "../../../../../../modules/tasks"
import type TaskService from "../../../../../../modules/tasks/service"
import productionRunsTasksLink from "../../../../../../links/production-runs-tasks"

type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "accepted"
  | "blocked"

type TaskPriority = "low" | "medium" | "high"

type UpdateProductionRunTaskBody = {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  start_date?: string | Date
  end_date?: string | Date
  metadata?: Record<string, any>
}

const assertLinked = async (
  req: MedusaRequest,
  runId: string,
  taskId: string
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: productionRunsTasksLink.entryPoint,
    fields: ["production_runs_id", "task_id"],
    filters: { production_runs_id: runId, task_id: taskId },
  })
  if (!data?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Task ${taskId} is not linked to production run ${runId}`
    )
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  await assertLinked(req, id, taskId)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "task",
    fields: ["*", "subtasks.*"],
    filters: { id: taskId },
  })

  if (!data?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Task ${taskId} not found`
    )
  }

  res.json({ task: data[0] })
}

export const POST = async (
  req: MedusaRequest<UpdateProductionRunTaskBody>,
  res: MedusaResponse
) => {
  const { id, taskId } = req.params
  await assertLinked(req, id, taskId)

  const body = (req.validatedBody as UpdateProductionRunTaskBody) ||
    (req.body as UpdateProductionRunTaskBody)

  const update: Record<string, any> = {}
  if (body.title !== undefined) update.title = body.title
  if (body.description !== undefined) update.description = body.description
  if (body.status !== undefined) update.status = body.status
  if (body.priority !== undefined) update.priority = body.priority
  if (body.start_date !== undefined) {
    update.start_date = body.start_date ? new Date(body.start_date) : null
  }
  if (body.end_date !== undefined) {
    update.end_date = body.end_date ? new Date(body.end_date) : null
  }
  if (body.metadata !== undefined) update.metadata = body.metadata

  const taskService = req.scope.resolve(TASKS_MODULE) as TaskService
  await taskService.updateTasks({
    selector: { id: taskId },
    data: update,
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "task",
    fields: ["*", "subtasks.*"],
    filters: { id: taskId },
  })

  res.json({ task: data?.[0] })
}
