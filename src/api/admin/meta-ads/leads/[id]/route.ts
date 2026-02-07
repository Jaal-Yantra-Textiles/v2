/**
 * @file Admin API routes for managing Meta Ads leads
 * @description Provides endpoints for retrieving, updating, and deleting leads from Meta Ads in the JYT Commerce platform
 * @module API/Admin/MetaAds/Leads
 */

/**
 * @typedef {Object} Lead
 * @property {string} id - The unique identifier for the lead
 * @property {string} status - Current status of the lead (e.g., "new", "contacted", "qualified", "converted", "archived")
 * @property {string} [notes] - Additional notes about the lead
 * @property {string} [assigned_to] - User ID of the assigned sales representative
 * @property {Date} [assigned_at] - When the lead was assigned
 * @property {number} [estimated_value] - Estimated deal value
 * @property {number} [actual_value] - Actual deal value
 * @property {string} [person_id] - Associated person ID
 * @property {Date} [contacted_at] - When the lead was first contacted
 * @property {Date} [qualified_at] - When the lead was qualified
 * @property {Date} [converted_at] - When the lead was converted
 * @property {Date} created_at - When the lead was created
 * @property {Date} updated_at - When the lead was last updated
 */

/**
 * @typedef {Object} LeadUpdateInput
 * @property {string} [status] - New status for the lead
 * @property {string} [notes] - Updated notes about the lead
 * @property {string} [assigned_to] - User ID to assign the lead to
 * @property {number} [estimated_value] - Updated estimated deal value
 * @property {number} [actual_value] - Updated actual deal value
 * @property {string} [person_id] - Associated person ID
 */

/**
 * Get a single lead by ID
 * @route GET /admin/meta-ads/leads/:id
 * @group Meta Ads Leads - Operations related to Meta Ads leads
 * @param {string} id.path.required - The ID of the lead to retrieve
 * @returns {Object} 200 - The requested lead object
 * @throws {MedusaError} 404 - Lead not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/meta-ads/leads/lead_123456789
 *
 * @example response 200
 * {
 *   "lead": {
 *     "id": "lead_123456789",
 *     "status": "contacted",
 *     "notes": "Interested in premium subscription",
 *     "assigned_to": "user_987654321",
 *     "assigned_at": "2023-01-15T10:30:00Z",
 *     "estimated_value": 5000,
 *     "actual_value": null,
 *     "person_id": "person_112233445",
 *     "contacted_at": "2023-01-10T14:20:00Z",
 *     "qualified_at": null,
 *     "converted_at": null,
 *     "created_at": "2023-01-05T09:15:00Z",
 *     "updated_at": "2023-01-15T10:30:00Z"
 *   }
 * }
 */

/**
 * Update a lead (status, notes, assignment, etc.)
 * @route PATCH /admin/meta-ads/leads/:id
 * @group Meta Ads Leads - Operations related to Meta Ads leads
 * @param {string} id.path.required - The ID of the lead to update
 * @param {LeadUpdateInput} request.body.required - Lead data to update
 * @returns {Object} 200 - The updated lead object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 404 - Lead not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * PATCH /admin/meta-ads/leads/lead_123456789
 * {
 *   "status": "qualified",
 *   "notes": "Ready to purchase, needs contract review",
 *   "assigned_to": "user_555666777",
 *   "estimated_value": 7500
 * }
 *
 * @example response 200
 * {
 *   "lead": {
 *     "id": "lead_123456789",
 *     "status": "qualified",
 *     "notes": "Ready to purchase, needs contract review",
 *     "assigned_to": "user_555666777",
 *     "assigned_at": "2023-01-20T11:45:00Z",
 *     "estimated_value": 7500,
 *     "actual_value": null,
 *     "person_id": "person_112233445",
 *     "contacted_at": "2023-01-10T14:20:00Z",
 *     "qualified_at": "2023-01-20T11:45:00Z",
 *     "converted_at": null,
 *     "created_at": "2023-01-05T09:15:00Z",
 *     "updated_at": "2023-01-20T11:45:00Z"
 *   }
 * }
 */

/**
 * Delete a lead (soft delete - sets status to archived)
 * @route DELETE /admin/meta-ads/leads/:id
 * @group Meta Ads Leads - Operations related to Meta Ads leads
 * @param {string} id.path.required - The ID of the lead to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 404 - Lead not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * DELETE /admin/meta-ads/leads/lead_123456789
 *
 * @example response 200
 * {
 *   "id": "lead_123456789",
 *   "deleted": true
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/leads/:id
 * 
 * Get a single lead by ID
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    const lead = await socials.retrieveLead(id)

    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
      })
    }

    res.json({ lead })
  } catch (error: any) {
    console.error("Failed to get lead:", error)
    res.status(500).json({
      message: "Failed to get lead",
      error: error.message,
    })
  }
}

/**
 * PATCH /admin/meta-ads/leads/:id
 * 
 * Update a lead (status, notes, assignment, etc.)
 * 
 * Body:
 * - status: Lead status
 * - notes: Notes about the lead
 * - assigned_to: User ID to assign to
 * - estimated_value: Estimated deal value
 * - actual_value: Actual deal value
 */
export const PATCH = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params
    const body = req.body as Record<string, any>

    // Build update data
    const updateData: Record<string, any> = {}

    if (body.status !== undefined) {
      updateData.status = body.status
      
      // Set status timestamps
      if (body.status === "contacted" && !body.contacted_at) {
        updateData.contacted_at = new Date()
      }
      if (body.status === "qualified" && !body.qualified_at) {
        updateData.qualified_at = new Date()
      }
      if (body.status === "converted" && !body.converted_at) {
        updateData.converted_at = new Date()
      }
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes
    }

    if (body.assigned_to !== undefined) {
      updateData.assigned_to = body.assigned_to
      updateData.assigned_at = new Date()
    }

    if (body.estimated_value !== undefined) {
      updateData.estimated_value = body.estimated_value
    }

    if (body.actual_value !== undefined) {
      updateData.actual_value = body.actual_value
    }

    if (body.person_id !== undefined) {
      updateData.person_id = body.person_id
    }

    // Update the lead
    await socials.updateLeads([{
      selector: { id },
      data: updateData,
    }])

    // Retrieve updated lead
    const lead = await socials.retrieveLead(id)

    res.json({ lead })
  } catch (error: any) {
    console.error("Failed to update lead:", error)
    res.status(500).json({
      message: "Failed to update lead",
      error: error.message,
    })
  }
}

/**
 * DELETE /admin/meta-ads/leads/:id
 * 
 * Delete a lead (soft delete - sets status to archived)
 */
export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    // Soft delete by setting status to archived
    await socials.updateLeads([{
      selector: { id },
      data: { status: "archived" as const },
    }])

    res.json({
      id,
      deleted: true,
    })
  } catch (error: any) {
    console.error("Failed to delete lead:", error)
    res.status(500).json({
      message: "Failed to delete lead",
      error: error.message,
    })
  }
}
