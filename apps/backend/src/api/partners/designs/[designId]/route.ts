/**
 * @file Partner API route for retrieving design details
 * @description Provides endpoints for partners to fetch detailed information about specific designs, including workflow status and inventory items
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} DesignTask
 * @property {string} title - The title of the task
 * @property {string} status - The status of the task (e.g., "completed")
 * @property {string} updated_at - When the task was last updated (ISO 8601)
 * @property {Record<string, unknown>} metadata - Additional task metadata
 */

/**
 * @typedef {Object} PartnerInfo
 * @property {string} assigned_partner_id - The ID of the partner assigned to this design
 * @property {"incoming"|"assigned"|"in_progress"|"finished"|"completed"} partner_status - The current status of the design for this partner
 * @property {"redo"|null} partner_phase - The current phase of the design (null if not in redo phase)
 * @property {string|null} partner_started_at - When the partner started working on the design (ISO 8601)
 * @property {string|null} partner_finished_at - When the partner finished working on the design (ISO 8601)
 * @property {string|null} partner_completed_at - When the design was completed by the partner (ISO 8601)
 * @property {number} workflow_tasks_count - The number of workflow tasks associated with this design
 */

/**
 * @typedef {Object} InventoryItem
 * @property {string} id - The unique identifier for the inventory item
 * @property {Object[]} raw_materials - List of raw materials associated with this inventory item
 * @property {Object[]} location_levels - List of location levels for this inventory item
 */

/**
 * @typedef {Object} DesignResponse
 * @property {string} id - The unique identifier for the design
 * @property {string} title - The title of the design
 * @property {string} status - The status of the design
 * @property {string} created_at - When the design was created (ISO 8601)
 * @property {string} updated_at - When the design was last updated (ISO 8601)
 * @property {Record<string, unknown>} metadata - Additional design metadata
 * @property {DesignTask[]} tasks - List of tasks associated with this design
 * @property {PartnerInfo} partner_info - Information about the partner's status and workflow for this design
 * @property {InventoryItem[]} inventory_items - List of inventory items associated with this design
 */

/**
 * Get a specific design by ID for a partner
 * @route GET /partners/designs/{designId}
 * @group Design - Operations related to designs
 * @param {string} designId.path.required - The ID of the design to retrieve
 * @returns {Object} 200 - The design object with partner-specific information
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Design not found for this partner
 *
 * @example request
 * GET /partners/designs/design_123456789
 *
 * @example response 200
 * {
 *   "design": {
 *     "id": "design_123456789",
 *     "title": "Summer Collection 2023",
 *     "status": "published",
 *     "created_at": "2023-01-15T10:30:00Z",
 *     "updated_at": "2023-02-20T14:45:00Z",
 *     "metadata": {
 *       "season": "summer",
 *       "year": 2023,
 *       "partner_status": "in_progress"
 *     },
 *     "tasks": [
 *       {
 *         "title": "partner-design-start",
 *         "status": "completed",
 *         "updated_at": "2023-02-01T09:00:00Z",
 *         "metadata": {}
 *       },
 *       {
 *         "title": "partner-design-finish",
 *         "status": "pending",
 *         "updated_at": null,
 *         "metadata": {}
 *       }
 *     ],
 *     "partner_info": {
 *       "assigned_partner_id": "partner_987654321",
 *       "partner_status": "in_progress",
 *       "partner_phase": null,
 *       "partner_started_at": "2023-02-01T09:00:00Z",
 *       "partner_finished_at": null,
 *       "partner_completed_at": null,
 *       "workflow_tasks_count": 2
 *     },
 *     "inventory_items": [
 *       {
 *         "id": "inv_item_111111111",
 *         "raw_materials": [
 *           {
 *             "id": "mat_222222222",
 *             "name": "Cotton Fabric",
 *             "quantity": 100
 *           }
 *         ],
 *         "location_levels": [
 *           {
 *             "id": "loc_lvl_333333333",
 *             "stock_locations": [
 *               {
 *                 "id": "stock_loc_444444444",
 *                 "name": "Warehouse A",
 *                 "address": "123 Main St"
 *               }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import listSingleDesignsWorkflow from "../../../../workflows/designs/list-single-design"
import designPartnersLink from "../../../../links/design-partners-link"
import { updateDesignWorkflow } from "../../../../workflows/designs/update-design"
import { deleteDesignWorkflow } from "../../../../workflows/designs/delete-design"
import { PartnerUpdateDesign } from "../validators"
import { assertPartnerOwnsDesign } from "../helpers"


export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const { designId } = req.params

  // Partner auth
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify this design is linked to this partner and fetch tasks via link
  const linkResult = await query.graph({
    entity: designPartnersLink.entryPoint,
    fields: [
      "design.*",
      "design.tasks.*",
      "partner.*",
    ],
    filters: { design_id: designId, partner_id: partner.id },
    pagination: { skip: 0, take: 1 },
  })
  const linkData = (linkResult?.data || [])[0]
  if (!linkData || !linkData.design) {
    return res.status(404).json({ error: "Design not found for this partner" })
  }

  // Use admin single-design workflow to fetch the full design shape
  const { result: workflowDesign } = await listSingleDesignsWorkflow(req.scope).run({
    input: { id: designId, fields: ["*"] },
  })

  const designMeta = (workflowDesign as any)?.metadata || (linkData.design as any)?.metadata || {}

  let partner_phase: "redo" | null = null
  let partner_started_at: string | null = null
  let partner_finished_at: string | null = null
  let partner_completed_at: string | null = null
  let resolvedFromRun = false

  let partner_status: "incoming" | "assigned" | "in_progress" | "awaiting_review" | "finished" | "completed" | "cancelled" =
    "incoming"

  // ── Single source of truth: production runs ──────────────────────────
  // For any design that has production runs, status derives PURELY from
  // those runs — including "cancelled" from a cancelled run. The legacy
  // `partner_assignment_cancelled_at` marker and v1 task fallback are NOT
  // consulted here (they only apply to legacy designs that have no runs,
  // below). Cancelling the assignment cancels the run, so a cancelled
  // assignment is represented by a cancelled run — no separate flag.
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { design_id: designId, partner_id: partner.id },
    fields: ["id", "status", "accepted_at", "started_at", "finished_at", "completed_at", "created_at"],
    pagination: { skip: 0, take: 50 },
  })
  const allRuns = ((runs || []) as any[])
    .slice()
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

  if (allRuns.length) {
    resolvedFromRun = true
    // An active (non-terminal) run wins over terminal ones; otherwise the
    // newest run decides (completed vs cancelled).
    const activeRun = allRuns.find((r) =>
      ["in_progress", "sent_to_partner", "approved", "pending_review"].includes(String(r.status))
    )
    if (activeRun) {
      const runStatus = String(activeRun.status)
      if (runStatus === "in_progress") {
        partner_status = activeRun.finished_at
          ? "awaiting_review"
          : activeRun.started_at
            ? "in_progress"
            : "assigned"
      } else {
        // sent_to_partner / approved / pending_review
        partner_status = "assigned"
      }
      if (activeRun.accepted_at) partner_started_at = String(activeRun.accepted_at)
      if (activeRun.started_at) partner_started_at = String(activeRun.started_at)
      if (activeRun.finished_at) partner_finished_at = String(activeRun.finished_at)
    } else {
      const newest = allRuns[0]
      const runStatus = String(newest.status)
      if (runStatus === "completed") {
        partner_status = "completed"
        partner_completed_at = newest.completed_at ? String(newest.completed_at) : null
        if (newest.finished_at) partner_finished_at = String(newest.finished_at)
      } else if (runStatus === "cancelled") {
        partner_status = "cancelled"
      }
    }
  }

  // ── Legacy fallback (designs with NO production runs only) ────────────
  // Pure-v1 designs predate the production-runs system. Until they're
  // migrated (see V1_PARTNER_DESIGN_REMOVAL_PLAN.md), honour the cancel
  // marker, then derive from v1 tasks.
  const wasCancelled = !resolvedFromRun && !!designMeta.partner_assignment_cancelled_at
  if (wasCancelled) {
    partner_status = "cancelled"
  }
  if (!resolvedFromRun && !wasCancelled) {
    const tasks = (linkData.design?.tasks || []) as Array<{
      title?: string
      status?: string
      updated_at?: string | Date | null
    }>
    const v1TaskTitles = [
      "partner-design-start",
      "partner-design-redo",
      "partner-design-finish",
      "partner-design-completed",
    ]
    const wfTasks = tasks.filter((t) => !!t && v1TaskTitles.includes(t.title!))
    if (wfTasks.length > 0) {
      const findCompleted = (title: string) => wfTasks.find((t) => t.title === title && t.status === "completed")
      const startTask = findCompleted("partner-design-start")
      const redoTask = findCompleted("partner-design-redo")
      const finishTask = findCompleted("partner-design-finish")
      const completedTask = findCompleted("partner-design-completed")

      partner_status = "assigned"
      if (completedTask) {
        partner_status = "completed"
        partner_completed_at = completedTask.updated_at ? String(completedTask.updated_at) : null
      } else if (redoTask) {
        partner_status = "in_progress"
        partner_phase = "redo"
      } else if (finishTask) {
        partner_status = "finished"
        partner_finished_at = finishTask.updated_at ? String(finishTask.updated_at) : null
      } else if (startTask) {
        partner_status = "in_progress"
        partner_started_at = startTask.updated_at ? String(startTask.updated_at) : null
      }
    }
  }

  const partner_info = {
    assigned_partner_id: linkData.partner?.id || partner.id,
    partner_status,
    partner_phase,
    partner_started_at,
    partner_finished_at,
    partner_completed_at,
  }

  // Fetch linked inventory items (with raw_materials and stock_locations) for partner UI consumption list
  const invResult = await query.graph({
    entity: "designs",
    fields: [
      "id",
      "inventory_items.*",
      "inventory_items.raw_materials.*",
      "inventory_items.location_levels.*",
      "inventory_items.location_levels.stock_locations.*",
    ],
    filters: { id: designId },
  })

  const invNode = (invResult?.data || [])[0] || {}

  // Merge partner_info and inventory_items into the design payload
  const design = {
    ...(workflowDesign || linkData.design),
    partner_info,
    inventory_items: invNode?.inventory_items || [],
  }

  return res.status(200).json({ design })
}

/**
 * Update a partner-owned design.
 * @route PUT /partners/designs/{designId}
 *
 * Roadmap #6. Mirrors `PUT /admin/designs/:id`, guarded to the
 * owning partner (admin-assigned designs are read-only for partners).
 */
export const PUT = async (
  req: AuthenticatedMedusaRequest<PartnerUpdateDesign> & {
    params: { designId: string }
  },
  res: MedusaResponse
) => {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const body = req.validatedBody

  await updateDesignWorkflow(req.scope).run({
    input: { id: designId, ...(body as any) },
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "design",
      filters: { id: designId },
      fields: ["*", "colors.*", "size_sets.*"],
    },
    { locale: req.locale }
  )

  return res.status(200).json({ design: data?.[0] })
}

/**
 * Delete a partner-owned design.
 * @route DELETE /partners/designs/{designId}
 *
 * Roadmap #6. Mirrors the admin delete guard — blocked if the design
 * has active (non-cancelled, non-completed) production runs.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: activeRuns } = await query.graph({
    entity: "production_runs",
    filters: {
      design_id: designId,
      status: { $nin: ["cancelled", "completed"] },
    },
    fields: ["id", "status"],
    pagination: { skip: 0, take: 1 },
  })
  if ((activeRuns || []).length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot delete a design with active production runs. Cancel them first."
    )
  }

  await deleteDesignWorkflow(req.scope).run({ input: { id: designId } })

  return res.status(200).json({ id: designId, object: "design", deleted: true })
}
