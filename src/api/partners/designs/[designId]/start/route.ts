/**
 * @file Partner API route for starting a design workflow
 * @description Provides endpoints for partners to initiate the development process for a design
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} DesignStartResponse
 * @property {string} message - Success message
 * @property {Object} design - The updated design object
 * @property {string} design.id - The design ID
 * @property {string} design.status - The design status (e.g., "In_Development")
 * @property {Object} design.metadata - Additional design metadata
 * @property {string} design.metadata.partner_started_at - ISO timestamp when partner started the design
 * @property {string} design.metadata.partner_status - Current partner status (e.g., "in_progress")
 */

/**
 * Start a design workflow
 * @route POST /partners/designs/:designId/start
 * @group Design - Operations related to design workflows
 * @param {string} designId.path.required - The ID of the design to start
 * @returns {DesignStartResponse} 200 - Design successfully started
 * @throws {MedusaError} 400 - Design is not assigned to a partner workflow
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Failed to update design or workflow
 *
 * @example request
 * POST /partners/designs/design_123456789/start
 *
 * @example response 200
 * {
 *   "message": "Design started successfully",
 *   "design": {
 *     "id": "design_123456789",
 *     "status": "In_Development",
 *     "metadata": {
 *       "partner_started_at": "2023-11-15T14:30:00Z",
 *       "partner_status": "in_progress"
 *     }
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "Design is not assigned to a partner workflow"
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to update design",
 *   "details": ["Error details..."]
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
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
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
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
        partner_status: "in_progress",
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
