import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/campaigns/totals
 * 
 * Get aggregated totals across all campaigns
 * 
 * Query params:
 * - ad_account_id: Optional filter by ad account
 * - status: Optional filter by status
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { ad_account_id, status } = req.query as Record<string, string>

    // Build filters
    const filters: Record<string, any> = {}
    if (ad_account_id) {
      filters.ad_account_id = ad_account_id
    }
    if (status) {
      filters.status = status
    }

    // Fetch all campaigns (no pagination limit for totals)
    const campaigns = await socials.listAdCampaigns(filters, {
      take: 10000, // High limit to get all
    })

    // Calculate totals
    let totalSpend = 0
    let totalImpressions = 0
    let totalClicks = 0
    let totalLeads = 0
    let totalReach = 0
    let totalConversions = 0

    for (const campaign of campaigns) {
      totalSpend += Number(campaign.spend) || 0
      totalImpressions += Number(campaign.impressions) || 0
      totalClicks += Number(campaign.clicks) || 0
      totalLeads += Number(campaign.leads) || 0
      totalReach += Number(campaign.reach) || 0
      totalConversions += Number(campaign.conversions) || 0
    }

    // Calculate derived metrics
    const avgCTR = totalImpressions > 0 
      ? (totalClicks / totalImpressions) * 100 
      : 0
    
    const avgCPC = totalClicks > 0 
      ? totalSpend / totalClicks 
      : 0
    
    const avgCPM = totalImpressions > 0 
      ? (totalSpend / totalImpressions) * 1000 
      : 0
    
    const avgCPL = totalLeads > 0 
      ? totalSpend / totalLeads 
      : 0

    const avgCPA = totalConversions > 0 
      ? totalSpend / totalConversions 
      : 0

    res.json({
      totals: {
        spend: totalSpend,
        impressions: totalImpressions,
        clicks: totalClicks,
        leads: totalLeads,
        reach: totalReach,
        conversions: totalConversions,
        ctr: avgCTR,
        cpc: avgCPC,
        cpm: avgCPM,
        cpl: avgCPL,
        cpa: avgCPA,
        campaign_count: campaigns.length,
      },
    })
  } catch (error: any) {
    console.error("Failed to get campaign totals:", error)
    res.status(500).json({
      message: "Failed to get campaign totals",
      error: error.message,
    })
  }
}
