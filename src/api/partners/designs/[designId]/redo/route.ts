/**
 * @file Partner API route for initiating design redo workflow
 * @description Provides endpoints for partners to trigger redo cycles on design assignments
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} DesignRedoResponse
 * @property {string} message - Confirmation message about redo initiation
 */

/**
 * Initiate redo workflow for a design
 * @route POST /partners/designs/:designId/redo
 * @group Design - Operations related to design management
 * @param {string} designId.path.required - The ID of the design to redo
 * @returns {DesignRedoResponse} 200 - Redo workflow initiated successfully
 * @throws {MedusaError} 400 - No workflow transaction found to reopen for redo
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Failed to trigger redo workflow
 *
 * @example request
 * POST /partners/designs/design_123456789/redo
 *
 * @example response 200
 * {
 *   "message": "Redo acknowledged. Redo cycle started; awaiting re-finish."
 * }
 *
 * @example response 400
 * {
 *   "error": "No workflow transaction found to reopen for redo"
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to trigger redo workflow",
 *   "details": ["Error details..."]
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../../partners/helpers"
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
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
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
          partner_status: "in_progress",
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
  }

  res.status(200).json({
    message: "Redo acknowledged. Redo cycle started; awaiting re-finish.",
  })
}
