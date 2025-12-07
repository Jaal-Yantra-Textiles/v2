import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/lead-forms
 * 
 * List all lead forms
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { platform_id } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (platform_id) {
      filters.platform_id = platform_id
    }

    const leadForms = await socials.listLeadForms(filters)

    res.json({
      leadForms,
      count: leadForms.length,
    })
  } catch (error: any) {
    console.error("Failed to list lead forms:", error)
    res.status(500).json({
      message: "Failed to list lead forms",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/lead-forms
 * 
 * Create a lead form
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const leadForm = await socials.createLeadForms(body)

    res.json({ leadForm })
  } catch (error: any) {
    console.error("Failed to create lead form:", error)
    res.status(500).json({
      message: "Failed to create lead form",
      error: error.message,
    })
  }
}
