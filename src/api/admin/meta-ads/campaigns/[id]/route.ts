/**
 * @file Admin API route for retrieving Meta Ads campaigns with associated ad sets, ads, and insights
 * @description Provides endpoints for fetching detailed campaign information including nested ad sets, ads, and performance insights from the JYT Commerce platform
 * @module API/Admin/MetaAds/Campaigns
 */

/**
 * @typedef {Object} AdSet
 * @property {string} id - The unique identifier for the ad set
 * @property {string} name - The name of the ad set
 * @property {string} campaign_id - The ID of the parent campaign
 * @property {string} status - The status of the ad set (active/paused/deleted)
 * @property {Date} created_at - When the ad set was created
 */

/**
 * @typedef {Object} Ad
 * @property {string} id - The unique identifier for the ad
 * @property {string} name - The name of the ad
 * @property {string} ad_set_id - The ID of the parent ad set
 * @property {string} creative_id - The ID of the creative used in the ad
 * @property {string} status - The status of the ad (active/paused/deleted)
 * @property {Date} created_at - When the ad was created
 */

/**
 * @typedef {Object} AdInsight
 * @property {string} id - The unique identifier for the insight
 * @property {string} meta_campaign_id - The Meta campaign ID from Facebook
 * @property {string} campaign_id - The internal campaign ID
 * @property {string} meta_account_id - The Meta account ID from Facebook
 * @property {string} level - The level of the insight (campaign/ad_set/ad)
 * @property {number} impressions - Number of impressions
 * @property {number} clicks - Number of clicks
 * @property {number} spend - Amount spent
 * @property {Date} date_start - Start date of the insight period
 * @property {Date} date_stop - End date of the insight period
 */

/**
 * @typedef {Object} CampaignResponse
 * @property {string} id - The unique identifier for the campaign
 * @property {string} name - The name of the campaign
 * @property {string} meta_campaign_id - The Meta campaign ID from Facebook
 * @property {string} ad_account_id - The ID of the associated ad account
 * @property {string} objective - The campaign objective
 * @property {string} status - The status of the campaign (active/paused/deleted)
 * @property {Date} created_at - When the campaign was created
 * @property {AdSet[]} ad_sets - Array of ad sets belonging to this campaign
 * @property {Ad[]} ads - Array of ads belonging to this campaign's ad sets
 * @property {AdInsight[]} insights - Array of performance insights for this campaign
 */

/**
 * Get a single Meta Ads campaign with its ad sets, ads, and insights
 * @route GET /admin/meta-ads/campaigns/:id
 * @group Meta Ads - Operations related to Meta (Facebook) advertising
 * @param {string} id.path.required - The ID of the campaign to retrieve
 * @returns {Object} 200 - Campaign object with nested ad sets, ads, and insights
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Failed to get campaign due to server error
 *
 * @example request
 * GET /admin/meta-ads/campaigns/camp_123456789
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Summer Sale Campaign",
 *     "meta_campaign_id": "2384321000123456",
 *     "ad_account_id": "acc_987654321",
 *     "objective": "CONVERSIONS",
 *     "status": "active",
 *     "created_at": "2023-06-01T10:00:00Z",
 *     "ad_sets": [
 *       {
 *         "id": "set_111111111",
 *         "name": "Summer Sale - US",
 *         "campaign_id": "camp_123456789",
 *         "status": "active",
 *         "created_at": "2023-06-01T11:00:00Z"
 *       },
 *       {
 *         "id": "set_222222222",
 *         "name": "Summer Sale - EU",
 *         "campaign_id": "camp_123456789",
 *         "status": "active",
 *         "created_at": "2023-06-01T11:30:00Z"
 *       }
 *     ],
 *     "ads": [
 *       {
 *         "id": "ad_111111111",
 *         "name": "Summer Sale Banner",
 *         "ad_set_id": "set_111111111",
 *         "creative_id": "cre_111111111",
 *         "status": "active",
 *         "created_at": "2023-06-01T12:00:00Z"
 *       },
 *       {
 *         "id": "ad_222222222",
 *         "name": "Summer Sale Video",
 *         "ad_set_id": "set_111111111",
 *         "creative_id": "cre_222222222",
 *         "status": "active",
 *         "created_at": "2023-06-01T12:30:00Z"
 *       }
 *     ],
 *     "insights": [
 *       {
 *         "id": "ins_111111111",
 *         "meta_campaign_id": "2384321000123456",
 *         "campaign_id": "camp_123456789",
 *         "meta_account_id": "act_123456789012345",
 *         "level": "campaign",
 *         "impressions": 10000,
 *         "clicks": 500,
 *         "spend": 250.50,
 *         "date_start": "2023-06-01",
 *         "date_stop": "2023-06-07"
 *       }
 *     ]
 *   }
 * }
 *
 * @example response 404
 * {
 *   "message": "Campaign not found"
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to get campaign",
 *   "error": "Database connection error"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/campaigns/:id
 * 
 * Get a single campaign with its ad sets and ads
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    // Get campaign
    const campaign = await socials.retrieveAdCampaign(id)
    
    if (!campaign) {
      return res.status(404).json({
        message: "Campaign not found",
      })
    }

    // Get ad sets for this campaign
    const adSets = await socials.listAdSets({
      campaign_id: id,
    })

    // Get ads for each ad set
    const adSetIds = adSets.map((as: any) => as.id)
    let ads: any[] = []
    
    if (adSetIds.length > 0) {
      // Get all ads for all ad sets
      for (const adSetId of adSetIds) {
        const adSetAds = await socials.listAds({
          ad_set_id: adSetId, // Note: model uses ad_set_id not adset_id
        })
        ads = [...ads, ...adSetAds]
      }
    }

    // Get insights for this campaign using meta_campaign_id
    const metaCampaignId = (campaign as any).meta_campaign_id
    let insights: any[] = []
    
    // List all insights and filter by meta_campaign_id or campaign_id
    const allInsights = await socials.listAdInsights({} as any)
    console.log(`Total insights in DB: ${(allInsights as any[]).length}`)
    
    // Debug: log first few insights to see their structure
    if ((allInsights as any[]).length > 0) {
      const sample = (allInsights as any[])[0]
      console.log(`Sample insight fields: meta_campaign_id=${sample.meta_campaign_id}, campaign_id=${sample.campaign_id}, level=${sample.level}, meta_account_id=${sample.meta_account_id}`)
    }
    
    if (metaCampaignId) {
      insights = (allInsights as any[]).filter((i: any) => {
        // Match by meta_campaign_id or by internal campaign_id
        const matches = i.meta_campaign_id === metaCampaignId || i.campaign_id === id
        return matches
      })
    }
    
    // If no insights found by campaign, try to get all insights for the account
    if (insights.length === 0 && (campaign as any).ad_account_id) {
      const adAccount = await socials.retrieveAdAccount((campaign as any).ad_account_id)
      if (adAccount) {
        const metaAccountId = (adAccount as any).meta_account_id
        console.log(`No campaign insights, trying account ${metaAccountId}`)
        insights = (allInsights as any[]).filter((i: any) => 
          i.meta_account_id === metaAccountId
        )
      }
    }

    console.log(`Found ${insights.length} insights for campaign ${metaCampaignId}`)

    res.json({
      campaign: {
        ...campaign,
        ad_sets: adSets,
        ads,
        insights,
      },
    })
  } catch (error: any) {
    console.error("Failed to get campaign:", error)
    
    // Check if it's a not_found error
    if (error.type === "not_found" || error.message?.includes("was not found")) {
      return res.status(404).json({
        message: "Campaign not found",
      })
    }
    
    res.status(500).json({
      message: "Failed to get campaign",
      error: error.message,
    })
  }
}
