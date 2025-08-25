import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../../partners/helpers"
import { updateDesignWorkflow } from "../../../../../workflows/designs/update-design"
import { TASKS_MODULE } from "../../../../../modules/tasks"
import TaskService from "../../../../../modules/tasks/service"
import { setDesignStepFailedWorkflow } from "../../../../../workflows/designs/design-steps"

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

  // Update design status/metadata for redo
  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      status: "In_Development",
      metadata: {
        partner_redo_at: new Date().toISOString(),
        partner_phase: "redo",
      },
    },
  })
  if (errors && errors.length) {
    return res.status(500).json({ error: "Failed to update design", details: errors })
  }

  // Mark the redo task as completed
  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)
  for (const d of taskLinks) {
    if (d.tasks && Array.isArray(d.tasks)) {
      const redoTasks = d.tasks.filter(
        (task: any) => task.title === "partner-design-redo" && task.status !== "completed"
      )
      for (const task of redoTasks) {
        await taskService.updateTasks({
          id: task?.id,
          status: "completed",
          metadata: { ...task?.metadata, completed_at: new Date().toISOString(), completed_by: "partner" },
        })
      }
    }
  }

  // Derive transactionId from tasks: prefer 'partner-design-finish', fallback to any with transaction_id
  let transactionId: string | null = null
  for (const d of taskLinks) {
    if (Array.isArray(d.tasks)) {
      const finishTask = d.tasks.find((t: any) => t?.title === "partner-design-finish" && t?.transaction_id)
      if (finishTask?.transaction_id) {
        transactionId = finishTask.transaction_id
        break
      }
    }
  }
  if (!transactionId) {
    for (const d of taskLinks) {
      if (Array.isArray(d.tasks)) {
        const anyTx = d.tasks.find((t: any) => t?.transaction_id)
        if (anyTx?.transaction_id) {
          transactionId = anyTx.transaction_id
          break
        }
      }
    }
  }

  if (!transactionId) {
    return res.status(400).json({ error: "No workflow transaction found to reopen for redo" })
  }

  // Mark await-design-finish as FAILED to reopen it in the same transaction
  console.info(`[DesignWF] redo: setStepFailure for await-design-finish using tx ${transactionId}`)
  const { errors: failErrors } = await setDesignStepFailedWorkflow(req.scope).run({
    input: {
      stepId: "await-design-finish",
      updatedDesign: result[0],
      error: "redo_requested",
    },
  })
  if (failErrors && failErrors.length) {
    return res.status(500).json({ error: "Failed to set step failure for redo", details: failErrors })
  }

  // After reopening the step, revert tasks that marked the design as finished/completed
  console.info(`[DesignWF] redo: reverting task statuses (finish/completed -> assigned) for design ${designId}`)
  try {
    const updates: Promise<any>[] = []
    for (const d of taskLinks) {
      if (Array.isArray(d.tasks)) {
        // Revert FINISH task(s)
        const finishedTasks = d.tasks.filter(
          (t: any) => t?.title === "partner-design-finish" && t?.status === "completed"
        )
        for (const t of finishedTasks) {
          updates.push(
            taskService.updateTasks({
              id: t?.id,
              status: "assigned",
              metadata: { ...t?.metadata, rollback_reason: "redo_requested", rollback_at: new Date().toISOString() },
            })
          )
        }

        // Optionally revert COMPLETED task(s) if any exist
        const completedTasks = d.tasks.filter(
          (t: any) => t?.title === "partner-design-completed" && t?.status === "completed"
        )
        for (const t of completedTasks) {
          updates.push(
            taskService.updateTasks({
              id: t?.id,
              status: "assigned",
              metadata: { ...t?.metadata, rollback_reason: "redo_requested", rollback_at: new Date().toISOString() },
            })
          )
        }
      }
    }
    if (updates.length) {
      await Promise.all(updates)
    }
  } catch (e: any) {
    return res.status(500).json({ error: "Failed to revert tasks after cancel", details: e?.message || e })
  }

  res.status(200).json({
    message: "Redo acknowledged. Finish step reopened; awaiting finish again.",
    design: result[0],
  })
}
