import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../../../helpers"
import { completePartnerSubtaskWorkflow } from "../../../../../../../workflows/tasks/complete-partner-subtask"

/**
 * POST /partners/assigned-tasks/[taskId]/subtasks/[subtaskId]/complete
 * Thin route — orchestration lives in `completePartnerSubtaskWorkflow`.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { taskId, subtaskId } = req.params
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required - no actor ID" })
  }

  try {
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
    if (!partner) {
      return res.status(401).json({ error: "Partner authentication required - no partner found" })
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["*", "partners.*"],
      filters: { id: taskId },
    })
    if (!taskData?.length) {
      return res.status(404).json({ error: "Task not found" })
    }
    const task = taskData[0] as any
    const isLinked = Array.isArray(task.partners)
      && task.partners.some((p: any) => p.id === partner.id)
    if (!isLinked) {
      return res.status(403).json({ error: "Task not assigned to this partner" })
    }

    const { result, errors } = await completePartnerSubtaskWorkflow(req.scope).run({
      input: { task_id: taskId, subtask_id: subtaskId },
    })
    if (errors?.length) {
      const first: any = errors[0]
      const err = first?.error || first
      console.error("Error completing subtask:", err)
      const type = err?.type || err?.name
      const statusByType: Record<string, number> = {
        not_found: 404,
        not_allowed: 400,
        invalid_data: 400,
      }
      const status = statusByType[type] || 500
      return res.status(status).json({
        error: err?.message || "Failed to complete subtask",
      })
    }

    const parentCompleted = (result as any)?.parent_completed?.parent_completed === true
    res.status(200).json({
      subtask: (result as any).subtask,
      parent_completed: parentCompleted,
      message: parentCompleted
        ? "Subtask completed and all tasks finished!"
        : "Subtask completed successfully",
    })
  } catch (error) {
    console.error("Error completing subtask:", error)
    res.status(500).json({
      error: "Failed to complete subtask",
      details: error instanceof Error ? error.message : String(error),
    })
  }
}
