import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../helpers"
import { updateDesignWorkflow } from "../../../../../workflows/designs/update-design"
import { TASKS_MODULE } from "../../../../../modules/tasks"
import TaskService from "../../../../../modules/tasks/service"
import { setDesignStepSuccessWorkflow, setDesignStepFailedWorkflow } from "../../../../../workflows/designs/design-steps"

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

  // Load tasks linked to this design
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const taskLinksResult = await query.graph({
    entity: "designs",
    fields: ["id", "tasks.*"],
    filters: { id: designId },
  })
  const taskLinks = taskLinksResult.data || []

  // Update design status/metadata as Approved
  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      status: "Approved",
      metadata: {
        partner_completed_at: new Date().toISOString(),
        partner_status: "completed",
      },
    },
  })
  if (errors && errors.length) {
    return res.status(500).json({ error: "Failed to update design", details: errors })
  }

  // Mark the completed task as completed
  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)
  for (const d of taskLinks) {
    if (d.tasks && Array.isArray(d.tasks)) {
      const completedTasks = d.tasks.filter(
        (task: any) => task.title === "partner-design-completed" && task.status !== "completed"
      )
      for (const task of completedTasks) {
        await taskService.updateTasks({
          id: task?.id,
          status: "completed",
          metadata: { ...task?.metadata, completed_at: new Date().toISOString(), completed_by: "partner" },
        })
      }

      // Option A: also complete redo-verify child if present
      const redoVerify = d.tasks.find((t: any) => t?.title === "partner-design-redo-verify" && t?.status !== "completed")
      if (redoVerify) {
        await taskService.updateTasks({
          id: redoVerify.id,
          status: "completed",
          metadata: { ...(redoVerify.metadata || {}), completed_at: new Date().toISOString(), completed_by: "partner" },
        })
      }

      // Cancel any leftover redo-related tasks if redo was bypassed (not completed)
      const redoTitles = new Set([
        "partner-design-redo",
        "partner-design-redo-log",
        "partner-design-redo-apply",
        "partner-design-redo-verify",
      ])
      const redoPending = d.tasks.filter((t: any) => redoTitles.has(t?.title) && t?.status !== "completed")
      for (const t of redoPending) {
        await taskService.updateTasks({
          id: t?.id,
          status: "cancelled",
          metadata: { ...(t?.metadata || {}), cancelled_at: new Date().toISOString(), cancelled_by: "system" },
        })
      }
    }
  }

  // Signal step success for await-design-completed
  // If redo phase was bypassed, proactively fail redo gates so the workflow can continue
  try {
    await setDesignStepFailedWorkflow(req.scope).run({
      input: { stepId: "await-design-redo", updatedDesign: result[0] },
    })
  } catch (e) {
    // ignore; step may be idle or not waiting
  }
  try {
    await setDesignStepFailedWorkflow(req.scope).run({
      input: { stepId: "await-design-refinish", updatedDesign: result[0] },
    })
  } catch (e) {
    // ignore; step may be idle or not waiting
  }

  const { errors: stepErrors } = await setDesignStepSuccessWorkflow(req.scope).run({
    input: {
      stepId: "await-design-completed",
      updatedDesign: result[0],
    },
  })
  if (stepErrors && stepErrors.length) {
    return res.status(500).json({ error: "Failed to update workflow", details: stepErrors })
  }

  res.status(200).json({
    message: "Design marked as completed",
    design: result[0],
  })
}
