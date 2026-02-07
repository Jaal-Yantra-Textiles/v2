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
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import listSingleDesignsWorkflow from "../../../../workflows/designs/list-single-design"
import designPartnersLink from "../../../../links/design-partners-link"


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

  // Determine if the design was sent via workflow tasks by checking known titles
  const tasks = (linkData.design?.tasks || []) as Array<{
    title?: string
    status?: string
    updated_at?: string | Date | null
    metadata?: Record<string, unknown> | null
  }>
  const isPartnerWorkflowTask = (t: any) =>
    !!t && [
      "partner-design-start",
      "partner-design-redo",
      "partner-design-finish",
      "partner-design-completed",
    ].includes(t.title)
  const wfTasks = tasks.filter(isPartnerWorkflowTask)
  const hasWorkflowTasks = wfTasks.length > 0

  // Use admin single-design workflow to fetch the full design shape
  const { result: workflowDesign } = await listSingleDesignsWorkflow(req.scope).run({
    input: { id: designId, fields: ["*"] },
  })

  // Helper to find completed tasks by title
  const findCompleted = (title: string) => wfTasks.find((t) => t.title === title && t.status === "completed")

  const startTask = findCompleted("partner-design-start")
  const redoTask = findCompleted("partner-design-redo")
  const finishTask = findCompleted("partner-design-finish")
  const completedTask = findCompleted("partner-design-completed")

  // Prefer metadata from the design node (authoritative), then infer from tasks
  let partner_status: "incoming" | "assigned" | "in_progress" | "finished" | "completed" =
    ((workflowDesign as any)?.metadata?.partner_status as any) || ((linkData.design as any)?.metadata?.partner_status as any) || (hasWorkflowTasks ? "assigned" : "incoming")
  let partner_phase: "redo" | null = ((workflowDesign as any)?.metadata?.partner_phase as any) || ((linkData.design as any)?.metadata?.partner_phase as any) || null
  let partner_started_at: string | null = ((workflowDesign as any)?.metadata?.partner_started_at as any) || ((linkData.design as any)?.metadata?.partner_started_at as any) || null
  let partner_finished_at: string | null = ((workflowDesign as any)?.metadata?.partner_finished_at as any) || ((linkData.design as any)?.metadata?.partner_finished_at as any) || null
  let partner_completed_at: string | null = ((workflowDesign as any)?.metadata?.partner_completed_at as any) || ((linkData.design as any)?.metadata?.partner_completed_at as any) || null

  if ((!partner_status || partner_status === "incoming" || partner_status === "assigned") && hasWorkflowTasks) {
    if (completedTask) {
      partner_status = "completed"
      partner_completed_at = partner_completed_at || (completedTask.updated_at ? String(completedTask.updated_at) : null)
    } else if (redoTask) {
      // Prefer redo state whenever redo task is completed, regardless of timestamp ordering vs finish
      partner_status = "in_progress"
      partner_phase = "redo"
    } else if (finishTask) {
      partner_status = "finished"
      partner_finished_at = partner_finished_at || (finishTask.updated_at ? String(finishTask.updated_at) : null)
    } else if (startTask) {
      partner_status = "in_progress"
      partner_started_at = partner_started_at || (startTask.updated_at ? String(startTask.updated_at) : null)
    }
  }

  const partner_info = {
    assigned_partner_id: linkData.partner?.id || partner.id,
    partner_status,
    partner_phase,
    partner_started_at,
    partner_finished_at,
    partner_completed_at,
    workflow_tasks_count: wfTasks.length,
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
