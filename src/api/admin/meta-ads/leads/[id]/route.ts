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
