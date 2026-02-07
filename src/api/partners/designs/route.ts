/**
 * @file Partner Designs API routes
 * @description Provides endpoints for retrieving design information associated with a partner in the JYT Commerce platform
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} ListDesignsQuery
 * @property {number} [limit=20] - Number of designs to return (default: 20)
 * @property {number} [offset=0] - Pagination offset (default: 0)
 * @property {string} [status] - Filter designs by status (e.g., "active", "inactive")
 */

/**
 * @typedef {Object} DesignTask
 * @property {string} id - The unique identifier for the task
 * @property {string} title - The title of the task
 * @property {string} status - The status of the task (e.g., "completed", "pending")
 * @property {Date} updated_at - When the task was last updated
 */

/**
 * @typedef {Object} Design
 * @property {string} id - The unique identifier for the design
 * @property {string} status - The status of the design
 * @property {DesignTask[]} tasks - List of tasks associated with the design
 * @property {Object} metadata - Additional metadata for the design
 * @property {string} metadata.partner_status - The partner status of the design
 * @property {string} metadata.partner_phase - The partner phase of the design
 * @property {string} metadata.partner_started_at - When the partner started working on the design
 * @property {string} metadata.partner_finished_at - When the partner finished working on the design
 * @property {string} metadata.partner_completed_at - When the partner completed the design
 */

/**
 * @typedef {Object} PartnerInfo
 * @property {string} assigned_partner_id - The ID of the assigned partner
 * @property {"incoming"|"assigned"|"in_progress"|"finished"|"completed"} partner_status - The status of the design from the partner's perspective
 * @property {"redo"|null} partner_phase - The current phase of the design
 * @property {string|null} partner_started_at - When the partner started working on the design
 * @property {string|null} partner_finished_at - When the partner finished working on the design
 * @property {string|null} partner_completed_at - When the partner completed the design
 * @property {number} workflow_tasks_count - The number of workflow tasks associated with the design
 */

/**
 * @typedef {Object} DesignResponse
 * @property {string} id - The unique identifier for the design
 * @property {string} status - The status of the design
 * @property {DesignTask[]} tasks - List of tasks associated with the design
 * @property {PartnerInfo} partner_info - Information about the partner's interaction with the design
 */

/**
 * @typedef {Object} ListDesignsResponse
 * @property {DesignResponse[]} designs - List of designs
 * @property {number} count - Total number of designs returned
 * @property {number} limit - Number of designs per page
 * @property {number} offset - Pagination offset
 */

/**
 * List designs associated with a partner
 * @route GET /partners/designs
 * @group Partner Designs - Operations related to partner designs
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=20] - Number of designs to return
 * @param {string} [status] - Filter designs by status
 * @returns {ListDesignsResponse} 200 - Paginated list of designs associated with the partner
 * @throws {MedusaError} 401 - Partner authentication required - no actor ID
 * @throws {MedusaError} 401 - Partner authentication required - no partner found
 *
 * @example request
 * GET /partners/designs?offset=0&limit=10&status=active
 *
 * @example response 200
 * {
 *   "designs": [
 *     {
 *       "id": "design_123456789",
 *       "status": "active",
 *       "tasks": [
 *         {
 *           "id": "task_123456789",
 *           "title": "partner-design-start",
 *           "status": "completed",
 *           "updated_at": "2023-01-01T00:00:00Z"
 *         }
 *       ],
 *       "partner_info": {
 *         "assigned_partner_id": "partner_123456789",
 *         "partner_status": "in_progress",
 *         "partner_phase": null,
 *         "partner_started_at": "2023-01-01T00:00:00Z",
 *         "partner_finished_at": null,
 *         "partner_completed_at": null,
 *         "workflow_tasks_count": 1
 *       }
 *     }
 *   ],
 *   "count": 1,
 *   "limit": 10,
 *   "offset": 0
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { ListDesignsQuery } from "./validators"
import designPartnersLink from "../../../links/design-partners-link"

export async function GET(
  req: AuthenticatedMedusaRequest<ListDesignsQuery>,
  res: MedusaResponse
) {
  const { limit = 20, offset = 0, status } = req.validatedQuery

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Authenticated partner
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required - no actor ID" })
  }
  
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required - no partner found" })
  }

  // Filters: cannot filter on linked design properties; filter post-query if needed
  const filters: any = { partner_id: partner.id }

  const { data: results } = await query.graph({
    entity: designPartnersLink.entryPoint,
    fields: [
      "design.*",
      "design.tasks.*",
      "partner.*",
    ],
    filters,
    pagination: { skip: offset, take: limit },
  })

  // Include all linked designs for this partner.
  // We'll compute assignment status based on presence of partner workflow tasks (by known titles).
  const allLinked = (results || [])

  // post-filter by design.status if requested
  let filtered = allLinked
  if (status) {
    filtered = allLinked.filter((linkData: any) => linkData.design?.status === status)
  }

  const designs = filtered.map((linkData: any) => {
    const design = linkData.design

    const tasks = design.tasks || []
    const isPartnerWorkflowTask = (t: any) =>
      !!t && [
        "partner-design-start",
        "partner-design-redo",
        "partner-design-finish",
        "partner-design-completed",
      ].includes(t.title)
    const workflowTasks = tasks.filter(isPartnerWorkflowTask)

    // Derive from metadata first (authoritative), then fall back to task-based inference
    let partnerStatus: "incoming" | "assigned" | "in_progress" | "finished" | "completed" =
      (design?.metadata?.partner_status as any) || "incoming"
    let partnerPhase: "redo" | null = (design?.metadata?.partner_phase as any) || null
    let partnerStartedAt: string | null = (design?.metadata?.partner_started_at as any) || null
    let partnerFinishedAt: string | null = (design?.metadata?.partner_finished_at as any) || null
    let partnerCompletedAt: string | null = (design?.metadata?.partner_completed_at as any) || null

    // If redo phase is flagged in metadata, reflect in-progress immediately (deterministic)
    if (partnerPhase === "redo") {
      partnerStatus = "in_progress"
    }

    if (workflowTasks.length > 0) {
      // start -> redo (optional) -> finish -> completed
      const startTask = workflowTasks.find((t: any) => t.title === "partner-design-start" && t.status === "completed")
      const redoTask = workflowTasks.find((t: any) => t.title === "partner-design-redo" && t.status === "completed")
      const finishTask = workflowTasks.find((t: any) => t.title === "partner-design-finish" && t.status === "completed")
      const completedTask = workflowTasks.find((t: any) => t.title === "partner-design-completed" && t.status === "completed")

      // If metadata didn't set a terminal state, infer from tasks
      if (!partnerStatus || partnerStatus === "incoming" || partnerStatus === "assigned") {
        partnerStatus = "assigned"
        if (completedTask) {
          partnerStatus = "completed"
          partnerCompletedAt = partnerCompletedAt || (completedTask.updated_at ? String(completedTask.updated_at) : null)
        } else if (redoTask) {
          // Prefer redo state whenever redo task is completed, regardless of timestamp ordering vs finish
          partnerStatus = "in_progress"
          partnerPhase = "redo"
        } else if (finishTask) {
          partnerStatus = "finished"
          partnerFinishedAt = partnerFinishedAt || (finishTask.updated_at ? String(finishTask.updated_at) : null)
        } else if (startTask) {
          partnerStatus = "in_progress"
          partnerStartedAt = partnerStartedAt || (startTask.updated_at ? String(startTask.updated_at) : null)
        }
      }
    }

    // Final safeguard: if phase is redo, ensure status reflects in-progress
    if (partnerPhase === "redo") {
      partnerStatus = "in_progress"
    }

    const partner_info = {
      assigned_partner_id: linkData.partner?.id || partner.id,
      partner_status: partnerStatus,
      partner_phase: partnerPhase,
      partner_started_at: partnerStartedAt,
      partner_finished_at: partnerFinishedAt,
      partner_completed_at: partnerCompletedAt,
      workflow_tasks_count: workflowTasks.length,
    }

    return {
      ...design,
      partner_info,
    }
  })

  res.status(200).json({
    designs,
    count: designs.length,
    limit,
    offset,
  })
}
