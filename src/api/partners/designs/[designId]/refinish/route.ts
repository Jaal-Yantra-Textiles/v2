/**
 * @file Partner API route for re-finishing designs
 * @description Provides endpoints for partners to mark designs as re-finished and update workflow status
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} DesignRefinishResponse
 * @property {string} message - Success message
 * @property {Object} design - The updated design object
 * @property {string} design.id - The design ID
 * @property {string} design.status - The updated design status
 * @property {Object} design.metadata - Design metadata
 * @property {string} design.metadata.partner_finished_at - Timestamp when partner finished
 * @property {string} design.metadata.partner_status - Partner status
 * @property {string|null} design.metadata.partner_phase - Current partner phase
 */

/**
 * Re-finish a design and update workflow status
 * @route POST /partners/designs/:designId/refinish
 * @group Design - Operations related to design management
 * @param {string} designId.path.required - The ID of the design to re-finish
 * @returns {DesignRefinishResponse} 200 - Design successfully re-finished
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Failed to update design or workflow
 *
 * @example request
 * POST /partners/designs/design_123456789/refinish
 *
 * @example response 200
 * {
 *   "message": "Design re-finished successfully",
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
