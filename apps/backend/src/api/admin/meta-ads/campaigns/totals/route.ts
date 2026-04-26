/**
 * @file Admin API route for retrieving aggregated campaign totals
 * @description Provides endpoints for fetching aggregated metrics across all Meta Ads campaigns in the JYT Commerce platform
 * @module API/Admin/MetaAds/Campaigns
 */

/**
 * @typedef {Object} CampaignTotalsResponse
 * @property {Object} totals - Aggregated metrics across all campaigns
 * @property {number} totals.spend - Total amount spent across all campaigns
 * @property {number} totals.impressions - Total number of impressions
 * @property {number} totals.clicks - Total number of clicks
 * @property {number} totals.leads - Total number of leads generated
 * @property {number} totals.reach - Total reach across all campaigns
 * @property {number} totals.conversions - Total number of conversions
 * @property {number} totals.ctr - Average click-through rate (percentage)
 * @property {number} totals.cpc - Average cost per click
 * @property {number} totals.cpm - Average cost per thousand impressions
 * @property {number} totals.cpl - Average cost per lead
 * @property {number} totals.cpa - Average cost per acquisition
 * @property {number} totals.campaign_count - Total number of campaigns included in the aggregation
 */

/**
 * Get aggregated totals across all Meta Ads campaigns
 * @route GET /admin/meta-ads/campaigns/totals
 * @group Meta Ads Campaigns - Operations related to Meta Ads campaigns
 * @param {string} [ad_account_id] - Optional filter by ad account ID
 * @param {string} [status] - Optional filter by campaign status
 * @returns {CampaignTotalsResponse} 200 - Aggregated campaign metrics
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/meta-ads/campaigns/totals?ad_account_id=act_123456789&status=active
 *
 * @example response 200
 * {
 *   "totals": {
 *     "spend": 5000.50,
 *     "impressions": 1000000,
 *     "clicks": 50000,
 *     "leads": 2500,
 *     "reach": 750000,
 *     "conversions": 1250,
 *     "ctr": 5.0,
 *     "cpc": 0.10,
 *     "cpm": 5.0,
 *     "cpl": 2.0,
 *     "cpa": 4.0,
 *     "campaign_count": 10
 *   }
 * }
 */
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
