import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../../partners/helpers"
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

  // Load tasks linked to this design
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const taskLinksResult = await query.graph({
    entity: "designs",
    fields: ["id", "tasks.*"],
    filters: { id: designId },
  })
  const taskLinks = taskLinksResult.data || []

  // Update design status/metadata (same as finish)
  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      status: "Technical_Review",
      metadata: {
        partner_finished_at: new Date().toISOString(),
        partner_status: "finished",
        partner_phase: null,
      },
    },
  })
  if (errors && errors.length) {
    return res.status(500).json({ error: "Failed to update design", details: errors })
  }

  // Mark the finish task as completed (force-update to refresh updated_at)
  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)
  for (const d of taskLinks) {
    if (d.tasks && Array.isArray(d.tasks)) {
      const finishTasks = d.tasks.filter(
        (task: any) => task.title === "partner-design-finish"
      )
      for (const task of finishTasks) {
        await taskService.updateTasks({
          id: task?.id,
          status: "completed",
          metadata: { ...task?.metadata, refinish_at: new Date().toISOString(), completed_at: new Date().toISOString(), completed_by: "partner" },
        })
      }

      // Option A: Advance redo-child tasks upon refinish
      const redoChildrenToComplete = d.tasks.filter((t: any) => {
        if (!t) return false
        const title = t.title as string | undefined
        const status = t.status as string | undefined
        return !!title && ["partner-design-redo-log", "partner-design-redo-apply"].includes(title) && status !== "completed"
      })
      for (const t of redoChildrenToComplete) {
        if (!t || !t.id) continue
        await taskService.updateTasks({
          id: t.id,
          status: "completed",
          metadata: { ...(t.metadata || {}), completed_at: new Date().toISOString(), completed_by: "partner" },
        })
      }
    }
  }

  // Signal re-finish gate explicitly (no retry/backoff)
  const { errors: refinishErrors } = await setDesignStepSuccessWorkflow(req.scope).run({
    input: { stepId: "await-design-refinish", updatedDesign: result[0] },
  })
  if (refinishErrors && refinishErrors.length) {
    return res.status(500).json({ error: "Failed to update workflow (refinish)", details: refinishErrors })
  }

  res.status(200).json({
    message: "Design re-finished successfully",
    design: result[0],
  })
}
