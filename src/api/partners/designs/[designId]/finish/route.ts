/**
 * @file Partner API route for marking designs as finished
 * @description Provides endpoints for partners to complete design workflows in the JYT Commerce platform
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} DesignFinishResponse
 * @property {string} message - Success message
 * @property {Object} design - The updated design object
 * @property {string} design.id - The design ID
 * @property {string} design.status - The updated design status
 * @property {Object} design.metadata - Design metadata
 * @property {string} design.metadata.partner_finished_at - ISO timestamp when partner finished
 * @property {string} design.metadata.partner_status - Partner status ("finished")
 * @property {string|null} design.metadata.partner_phase - Current partner phase
 */

/**
 * Mark a design as finished by partner
 * @route POST /partners/designs/:designId/finish
 * @group Design - Operations related to design management
 * @param {string} designId.path.required - The ID of the design to finish
 * @returns {DesignFinishResponse} 200 - Design successfully marked as finished
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Failed to update design or workflow
 *
 * @example request
 * POST /partners/designs/design_123456789/finish
 *
 * @example response 200
 * {
 *   "message": "Design marked as finished",
 *   "design": {
 *     "id": "design_123456789",
 *     "status": "Technical_Review",
 *     "metadata": {
 *       "partner_finished_at": "2023-11-15T14:30:00.000Z",
 *       "partner_status": "finished",
 *       "partner_phase": null
 *     }
 *   }
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
import { getPartnerFromAuthContext } from "../../../../partners/helpers"
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

  // Load tasks linked to this design
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const taskLinksResult = await query.graph({
    entity: "designs",
    fields: ["id", "tasks.*"],
    filters: { id: designId },
  })
  const taskLinks = taskLinksResult.data || []

  // Update design status/metadata
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

  // Mark the finish task as completed
  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)
  for (const d of taskLinks) {
    if (d.tasks && Array.isArray(d.tasks)) {
      const finishTasks = d.tasks.filter(
        (task: any) => task.title === "partner-design-finish" && task.status !== "completed"
      )
      for (const task of finishTasks) {
        await taskService.updateTasks({
          id: task?.id,
          status: "completed",
          metadata: { ...task?.metadata, completed_at: new Date().toISOString(), completed_by: "partner" },
        })
      }
    }
  }

  // Signal step success
  const { errors: finishErrors } = await setDesignStepSuccessWorkflow(req.scope).run({
    input: { stepId: "await-design-finish", updatedDesign: result[0] },
  })
  if (finishErrors && finishErrors.length) {
    return res.status(500).json({ error: "Failed to update workflow", details: finishErrors })
  }

  res.status(200).json({
    message: "Design marked as finished",
    design: result[0],
  })
}
