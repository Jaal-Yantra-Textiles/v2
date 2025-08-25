import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../../partners/helpers"
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

  // Derive transactionId from tasks
  let transactionId: string | null = null
  for (const d of taskLinks) {
    if (Array.isArray(d.tasks)) {
      const anyTx = d.tasks.find((t: any) => t?.transaction_id)
      if (anyTx?.transaction_id) {
        transactionId = anyTx.transaction_id
        break
      }
    }
  }

  if (!transactionId) {
    return res.status(400).json({ error: "No workflow transaction found to reopen for redo" })
  }

  // Signal success on the redo gate so the main workflow enters the redo sub-workflow
  console.info(`[DesignWF] redo: setStepSuccess for await-design-redo using tx ${transactionId}`)
  const { errors: stepErrors } = await setDesignStepSuccessWorkflow(req.scope).run({
    input: {
      stepId: "await-design-redo",
      updatedDesign: { id: designId },
    },
  })
  if (stepErrors && stepErrors.length) {
    return res.status(500).json({ error: "Failed to trigger redo workflow", details: stepErrors })
  }

  res.status(200).json({
    message: "Redo acknowledged. Redo cycle started; awaiting re-finish.",
  })
}
