import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/insights
 * 
 * List all insights
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { campaign_id, level } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (campaign_id) {
      filters.campaign_id = campaign_id
    }
    if (level) {
      filters.level = level
    }

    const insights = await socials.listAdInsights(filters as any)

    res.json({
      insights,
      count: (insights as any[]).length,
    })
  } catch (error: any) {
    console.error("Failed to list insights:", error)
    res.status(500).json({
      message: "Failed to list insights",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/insights
 * 
 * Create an insight record
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    // Ensure synced_at is set
    const insightData = {
      ...body,
      synced_at: body.synced_at || new Date(),
    }
    
    const insight = await socials.createAdInsights(insightData as any)

    res.json({ insight })
  } catch (error: any) {
    console.error("Failed to create insight:", error)
    res.status(500).json({
      message: "Failed to create insight",
      error: error.message,
    })
  }
}
