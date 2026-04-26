/**
 * @file Admin API routes for managing Meta Ads campaigns
 * @description Provides endpoints for creating and listing Meta Ads campaigns in the JYT Commerce platform
 * @module API/Admin/MetaAds
 */

/**
 * @typedef {Object} AdCampaignInput
 * @property {string} name - The name of the campaign
 * @property {string} ad_account_id - The Meta Ads account ID
 * @property {string} [status] - The status of the campaign (ACTIVE, PAUSED, etc.)
 * @property {string} [objective] - The campaign objective (e.g., LINK_CLICKS, CONVERSIONS)
 * @property {string} [budget] - The campaign budget
 * @property {string} [start_date] - The start date of the campaign (ISO format)
 * @property {string} [end_date] - The end date of the campaign (ISO format)
 */

/**
 * @typedef {Object} AdCampaignResponse
 * @property {string} id - The unique identifier of the campaign
 * @property {string} name - The name of the campaign
 * @property {string} ad_account_id - The Meta Ads account ID
 * @property {string} status - The status of the campaign (ACTIVE, PAUSED, etc.)
 * @property {string} objective - The campaign objective
 * @property {string} budget - The campaign budget
 * @property {string} start_date - The start date of the campaign (ISO format)
 * @property {string} end_date - The end date of the campaign (ISO format)
 * @property {Date} created_at - When the campaign was created
 * @property {Date} updated_at - When the campaign was last updated
 */

/**
 * @typedef {Object} ListCampaignsResponse
 * @property {AdCampaignResponse[]} campaigns - The list of campaigns
 * @property {number} count - The number of campaigns returned
 * @property {number} total - The total number of campaigns matching the filters
 * @property {number} limit - The pagination limit
 * @property {number} offset - The pagination offset
 */

/**
 * List Meta Ads campaigns with pagination and filtering
 * @route GET /admin/meta-ads/campaigns
 * @group Meta Ads - Operations related to Meta Ads campaigns
 * @param {string} [ad_account_id] - Filter by ad account ID
 * @param {string} [status] - Filter by status (ACTIVE, PAUSED, etc.)
 * @param {number} [limit=50] - Number of items to return (max 100)
 * @param {number} [offset=0] - Pagination offset
 * @returns {ListCampaignsResponse} 200 - Paginated list of campaigns
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/meta-ads/campaigns?ad_account_id=act_123456789&status=ACTIVE&limit=10&offset=0
 *
 * @example response 200
 * {
 *   "campaigns": [
 *     {
 *       "id": "camp_123456789",
 *       "name": "Summer Sale Campaign",
 *       "ad_account_id": "act_123456789",
 *       "status": "ACTIVE",
 *       "objective": "CONVERSIONS",
 *       "budget": "1000",
 *       "start_date": "2023-06-01T00:00:00Z",
 *       "end_date": "2023-06-30T23:59:59Z",
 *       "created_at": "2023-05-15T10:00:00Z",
 *       "updated_at": "2023-05-20T14:30:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "total": 5,
 *   "limit": 10,
 *   "offset": 0
 * }
 */

/**
 * Create a new Meta Ads campaign
 * @route POST /admin/meta-ads/campaigns
 * @group Meta Ads - Operations related to Meta Ads campaigns
 * @param {AdCampaignInput} request.body.required - Campaign data to create
 * @returns {AdCampaignResponse} 201 - Created campaign object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/meta-ads/campaigns
 * {
 *   "name": "Black Friday Campaign",
 *   "ad_account_id": "act_987654321",
 *   "status": "ACTIVE",
 *   "objective": "LINK_CLICKS",
 *   "budget": "5000",
 *   "start_date": "2023-11-20T00:00:00Z",
 *   "end_date": "2023-11-27T23:59:59Z"
 * }
 *
 * @example response 201
 * {
 *   "campaign": {
 *     "id": "camp_987654321",
 *     "name": "Black Friday Campaign",
 *     "ad_account_id": "act_987654321",
 *     "status": "ACTIVE",
 *     "objective": "LINK_CLICKS",
 *     "budget": "5000",
 *     "start_date": "2023-11-20T00:00:00Z",
 *     "end_date": "2023-11-27T23:59:59Z",
 *     "created_at": "2023-10-15T09:15:00Z",
 *     "updated_at": "2023-10-15T09:15:00Z"
 *   }
 * }
 */
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
