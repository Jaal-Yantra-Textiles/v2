import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/ads
 * 
 * List all ads
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { ad_set_id } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (ad_set_id) {
      filters.ad_set_id = ad_set_id
    }

    const ads = await socials.listAds(filters)

    res.json({
      ads,
      count: ads.length,
    })
  } catch (error: any) {
    console.error("Failed to list ads:", error)
    res.status(500).json({
      message: "Failed to list ads",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/ads
 * 
 * Create an ad
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const ad = await socials.createAds(body)

    res.json({ ad })
  } catch (error: any) {
    console.error("Failed to create ad:", error)
    res.status(500).json({
      message: "Failed to create ad",
      error: error.message,
    })
  }
}
