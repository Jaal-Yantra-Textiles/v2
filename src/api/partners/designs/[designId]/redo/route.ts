import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../../partners/helpers"
import { TASKS_MODULE } from "../../../../../modules/tasks"
import TaskService from "../../../../../modules/tasks/service"
import { setDesignStepSuccessWorkflow } from "../../../../../workflows/designs/design-steps"
import { updateDesignWorkflow } from "../../../../../workflows/designs/update-design"
import { createTasksFromTemplatesWorkflow } from "../../../../../workflows/designs/create-tasks-from-templates"

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
    fields: ["id", "status", "metadata", "tasks.*"],
    filters: { id: designId },
  })
  const taskLinks = taskLinksResult.data || []

  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)

  // Prepare design for redo phase: set status/phase in metadata
  try {
    const node = taskLinks[0]
    if (!node) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${designId} not found`)
    }
    await updateDesignWorkflow(req.scope).run({
      input: {
        id: designId,
          status: "In_Development",
          metadata: {
            ...(node.metadata || {}),
            partner_phase: "redo",
          },
      },
    })
  } catch (e) {
    // Non-fatal; continue
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

  // Create redo child tasks on-demand using templates and link to design
  const redoChildTemplates = [
    "partner-design-redo-log",
    "partner-design-redo-apply",
    "partner-design-redo-verify",
  ]
  try {
    const { result: created } = await createTasksFromTemplatesWorkflow(req.scope).run({
      input: {
        designId,
        type: "template",
        template_names: redoChildTemplates,
        metadata: {
          workflow_type: "partner_design_assignment",
          workflow_step: "redo_children",
        },
      } as any,
    })
    // Tag the newly created tasks with the current workflow transaction ID
    const createdTaskArray = Array.isArray((created as any)?.[1]) ? (created as any)[1] : []
    for (const t of createdTaskArray) {
      try {
        await taskService.updateTasks({ id: t.id, transaction_id: transactionId || undefined })
      } catch (_) {}
    }
  } catch (e) {
    // Non-fatal: if templates are missing, continue; redo refinish gate is already open
    console.warn("[DesignWF] redo child creation skipped:", e)
  }

  // Mark the parent redo task as completed so partner_info enters redo phase
  try {
    const refreshed = await query.graph({
      entity: "designs",
      fields: ["id", "tasks.*"],
      filters: { id: designId },
    })
    const nodes = refreshed.data || []
    for (const d of nodes) {
      if (Array.isArray(d.tasks)) {
        const redoParentTasks = d.tasks.filter((t: any) => t?.title === "partner-design-redo" && t?.status !== "completed")
        for (const t of redoParentTasks) {
          await taskService.updateTasks({
            id: t?.id,
            status: "completed",
            metadata: { ...(t?.metadata || {}), completed_at: new Date().toISOString(), completed_by: "partner" },
          })
        }
        // Set redo-log to in_progress to indicate work has started
        const redoLog = d.tasks.find((t: any) => t?.title === "partner-design-redo-log")
        if (redoLog) {
          await taskService.updateTasks({
            id: redoLog.id,
            status: "in_progress",
            metadata: { ...(redoLog.metadata || {}), started_at: new Date().toISOString(), started_by: "partner" },
          })
        }
      }
    }
  } catch (e) {
    console.warn("[DesignWF] unable to complete redo parent task:", e)
  }

  res.status(200).json({
    message: "Redo acknowledged. Redo cycle started; awaiting re-finish.",
  })
}
