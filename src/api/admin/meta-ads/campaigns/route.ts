import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/campaigns
 * 
 * List all synced campaigns
 * 
 * Query params:
 * - ad_account_id: Filter by ad account
 * - status: Filter by status (ACTIVE, PAUSED, etc.)
 * - limit: Number of results
 * - offset: Pagination offset
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    
    const {
      ad_account_id,
      status,
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string>

    const filters: Record<string, any> = {}
    
    if (ad_account_id) {
      filters.ad_account_id = ad_account_id
    }
    if (status) {
      filters.status = status
    }

    const campaigns = await socials.listAdCampaigns(filters, {
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
      order: { name: "ASC" },
    })

    const allCampaigns = await socials.listAdCampaigns(filters)

    res.json({
      campaigns,
      count: campaigns.length,
      total: allCampaigns.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    })
  } catch (error: any) {
    console.error("Failed to list campaigns:", error)
    res.status(500).json({
      message: "Failed to list campaigns",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/campaigns
 * 
 * Create a campaign
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const campaign = await socials.createAdCampaigns(body)

    res.json({ campaign })
  } catch (error: any) {
    console.error("Failed to create campaign:", error)
    res.status(500).json({
      message: "Failed to create campaign",
      error: error.message,
    })
  }
}
