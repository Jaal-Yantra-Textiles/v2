import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/adsets
 * 
 * List all ad sets
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { campaign_id } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (campaign_id) {
      filters.campaign_id = campaign_id
    }

    const adSets = await socials.listAdSets(filters)

    res.json({
      adSets,
      count: adSets.length,
    })
  } catch (error: any) {
    console.error("Failed to list ad sets:", error)
    res.status(500).json({
      message: "Failed to list ad sets",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/adsets
 * 
 * Create an ad set
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const adSet = await socials.createAdSets(body)

    res.json({ adSet })
  } catch (error: any) {
    console.error("Failed to create ad set:", error)
    res.status(500).json({
      message: "Failed to create ad set",
      error: error.message,
    })
  }
}
