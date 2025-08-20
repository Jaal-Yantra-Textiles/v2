import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../helpers"
import { updateDesignWorkflow } from "../../../../../workflows/designs/update-design"
import { TASKS_MODULE } from "../../../../../modules/tasks"
import TaskService from "../../../../../modules/tasks/service"
import { setDesignStepSuccessWorkflow } from "../../../../../workflows/designs/design-steps"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const designId = req.params.designId

  // Auth partner
  const adminId = req.auth_context.actor_id
  const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partnerAdmin) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  // Load tasks to get transaction id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const taskLinksResult = await query.graph({
    entity: "designs",
    fields: ["id", "tasks.*"],
    filters: { id: designId },
  })
  const taskLinks = taskLinksResult.data || []

  let transactionId: string | null = null
  for (const d of taskLinks) {
    if (d.tasks && Array.isArray(d.tasks)) {
      for (const t of d.tasks) {
        if (t && t.transaction_id) {
          transactionId = t.transaction_id
          break
        }
      }
      if (transactionId) break
    }
  }
  if (!transactionId) {
    return res.status(400).json({ error: "Design is not assigned to a partner workflow" })
  }

  // Update design status/metadata
  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      status: "In_Development",
      metadata: {
        partner_started_at: new Date().toISOString(),
        partner_status: "started",
      },
    },
  })
  if (errors && errors.length) {
    return res.status(500).json({ error: "Failed to update design", details: errors })
  }

  // Mark the start task as completed
  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)
  let tasksToUpdate: any[] = []
  for (const d of taskLinks) {
    if (d.tasks && Array.isArray(d.tasks)) {
      const startTasks = d.tasks.filter(
        (task: any) => task.title === "partner-design-start" && task.status !== "completed"
      )
      tasksToUpdate.push(...startTasks)
    }
  }
  if (tasksToUpdate.length > 0) {
    for (const task of tasksToUpdate) {
      await taskService.updateTasks({
        id: task.id,
        status: "completed",
        metadata: { ...task.metadata, completed_at: new Date().toISOString(), completed_by: "partner" },
      })
    }
  }

  // Signal step success
  const { errors: stepErrors } = await setDesignStepSuccessWorkflow(req.scope).run({
    input: {
      stepId: "await-design-start",
      updatedDesign: result[0],
    },
  })
  if (stepErrors && stepErrors.length) {
    return res.status(500).json({ error: "Failed to update workflow", details: stepErrors })
  }

  res.status(200).json({
    message: "Design started successfully",
    design: result[0],
  })
}
