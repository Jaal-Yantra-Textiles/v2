/**
 * @file Admin API routes for managing Meta Ads insights
 * @description Provides endpoints for retrieving and creating ad insights in the JYT Commerce platform
 * @module API/Admin/MetaAdsInsights
 */

/**
 * @typedef {Object} AdInsightInput
 * @property {string} campaign_id - The ID of the associated ad campaign
 * @property {string} level - The level of the insight (e.g., "ad", "campaign", "account")
 * @property {string} [synced_at] - The timestamp when the insight was synced (defaults to current time)
 * @property {Object} [metrics] - Additional metrics data for the insight
 */

/**
 * @typedef {Object} AdInsightResponse
 * @property {string} id - The unique identifier for the insight
 * @property {string} campaign_id - The ID of the associated ad campaign
 * @property {string} level - The level of the insight
 * @property {Date} synced_at - When the insight was synced
 * @property {Object} metrics - Additional metrics data for the insight
 * @property {Date} created_at - When the insight was created
 * @property {Date} updated_at - When the insight was last updated
 */

/**
 * @typedef {Object} ListInsightsResponse
 * @property {AdInsightResponse[]} insights - Array of insight objects
 * @property {number} count - Total count of insights returned
 */

/**
 * List Meta Ads insights with optional filtering
 * @route GET /admin/meta-ads/insights
 * @group Meta Ads Insights - Operations related to ad insights
 * @param {string} [campaign_id] - Filter insights by campaign ID
 * @param {string} [level] - Filter insights by level (e.g., "ad", "campaign", "account")
 * @returns {ListInsightsResponse} 200 - List of insights matching the filters
 * @throws {MedusaError} 500 - Internal server error when fetching insights
 *
 * @example request
 * GET /admin/meta-ads/insights?campaign_id=camp_123456789&level=ad
 *
 * @example response 200
 * {
 *   "insights": [
 *     {
 *       "id": "ins_123456789",
 *       "campaign_id": "camp_123456789",
 *       "level": "ad",
 *       "synced_at": "2023-01-01T00:00:00Z",
 *       "metrics": {
 *         "impressions": 1000,
 *         "clicks": 50,
 *         "spend": 25.50
 *       },
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new Meta Ads insight record
 * @route POST /admin/meta-ads/insights
 * @group Meta Ads Insights - Operations related to ad insights
 * @param {AdInsightInput} request.body.required - Insight data to create
 * @returns {Object} 200 - Created insight object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error when creating insight
 *
 * @example request
 * POST /admin/meta-ads/insights
 * {
 *   "campaign_id": "camp_123456789",
 *   "level": "ad",
 *   "metrics": {
 *     "impressions": 1000,
 *     "clicks": 50,
 *     "spend": 25.50
 *   }
 * }
 *
 * @example response 200
 * {
 *   "insight": {
 *     "id": "ins_123456789",
 *     "campaign_id": "camp_123456789",
 *     "level": "ad",
 *     "synced_at": "2023-01-01T00:00:00Z",
 *     "metrics": {
 *       "impressions": 1000,
 *       "clicks": 50,
 *       "spend": 25.50
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
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
