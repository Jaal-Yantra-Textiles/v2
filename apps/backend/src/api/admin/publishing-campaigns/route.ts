/**
 * @file Admin API routes for managing publishing campaigns
 * @description Provides endpoints for creating and listing publishing campaigns in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} CampaignItem
 * @property {string} product_id - The ID of the product to be published
 * @property {number} position - The position in the campaign sequence
 * @property {Date} scheduled_at - The scheduled publication time
 * @property {'pending'|'published'|'failed'} status - The current status of the item
 */

/**
 * @typedef {Object} ContentRule
 * @property {string} template - The content template for the post
 * @property {string[]} [hashtags] - Optional hashtags to include
 * @property {string} [caption_style] - Style of caption (e.g., "casual", "professional")
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier for the campaign
 * @property {string} name - The name of the campaign
 * @property {string} platform_id - The ID of the social platform
 * @property {ContentRule} content_rule - The content generation rules
 * @property {number} interval_hours - Hours between scheduled posts
 * @property {CampaignItem[]} items - The items in the campaign
 * @property {'draft'|'active'|'completed'|'paused'} status - Current campaign status
 * @property {number} current_index - The index of the last published item
 * @property {Date} created_at - When the campaign was created
 * @property {Date} updated_at - When the campaign was last updated
 */

/**
 * @typedef {Object} ListCampaignsResponse
 * @property {PublishingCampaign[]} campaigns - Array of publishing campaigns
 * @property {number} count - Total number of campaigns matching filters
 * @property {number} limit - Number of items returned
 * @property {number} offset - Pagination offset
 */

/**
 * @typedef {Object} CreateCampaignRequest
 * @property {string} name.required - The name of the campaign
 * @property {string[]} product_ids.required - Array of product IDs to include
 * @property {string} platform_id.required - The social platform ID
 * @property {ContentRule} [content_rule] - Custom content generation rules
 * @property {number} [interval_hours=24] - Hours between scheduled posts
 * @property {string} [start_at] - ISO date string for campaign start time
 */

/**
 * @typedef {Object} CreateCampaignResponse
 * @property {PublishingCampaign} campaign - The created campaign object
 */

/**
 * List publishing campaigns with pagination and filtering
 * @route GET /admin/publishing-campaigns
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} [status] - Filter by campaign status
 * @param {number} [limit=50] - Number of items to return (max 100)
 * @param {number} [offset=0] - Pagination offset
 * @returns {ListCampaignsResponse} 200 - Paginated list of publishing campaigns
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/publishing-campaigns?status=active&limit=10&offset=0
 *
 * @example response 200
 * {
 *   "campaigns": [
 *     {
 *       "id": "camp_123456789",
 *       "name": "Summer Collection 2023",
 *       "platform_id": "inst_987654321",
 *       "content_rule": {
 *         "template": "Check out our new {{product_name}}! 🔥 #summercollection",
 *         "hashtags": ["summer2023", "newarrival"]
 *       },
 *       "interval_hours": 24,
 *       "items": [
 *         {
 *           "product_id": "prod_111111111",
 *           "position": 0,
 *           "scheduled_at": "2023-06-15T09:00:00Z",
 *           "status": "pending"
 *         }
 *       ],
 *       "status": "active",
 *       "current_index": 0,
 *       "created_at": "2023-06-10T14:30:00Z",
 *       "updated_at": "2023-06-12T08:15:00Z"
 *     }
 *   ],
 *   "count": 42,
 *   "limit": 10,
 *   "offset": 0
 * }
 */

/**
 * Create a new publishing campaign
 * @route POST /admin/publishing-campaigns
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {CreateCampaignRequest} request.body.required - Campaign data to create
 * @returns {CreateCampaignResponse} 201 - Created campaign object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Platform not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/publishing-campaigns
 * {
 *   "name": "New Product Launch",
 *   "product_ids": ["prod_111111111", "prod_222222222", "prod_333333333"],
 *   "platform_id": "inst_987654321",
 *   "content_rule": {
 *     "template": "Just launched: {{product_name}}! 🚀 #newproduct",
 *     "hashtags": ["launch", "exclusive"]
 *   },
 *   "interval_hours": 48,
 *   "start_at": "2023-07-01T12:00:00Z"
 * }
 *
 * @example response 201
 * {
 *   "campaign": {
 *     "id": "camp_987654321",
 *     "name": "New Product Launch",
 *     "platform_id": "inst_987654321",
 *     "content_rule": {
 *       "template": "Just launched: {{product_name}}! 🚀 #newproduct",
 *       "hashtags": ["launch", "exclusive"]
 *     },
 *     "interval_hours": 48,
 *     "items": [
 *       {
 *         "product_id": "prod_111111111",
 *         "position": 0,
 *         "scheduled_at": "2023-07-01T12:00:00Z",
 *         "status": "pending"
 *       },
 *       {
 *         "product_id": "prod_222222222",
 *         "position": 1,
 *         "scheduled_at": "2023-07-03T12:00:00Z",
 *         "status": "pending"
 *       },
 *       {
 *         "product_id": "prod_333333333",
 *         "position": 2,
 *         "scheduled_at": "2023-07-05T12:00:00Z",
 *         "status": "pending"
 *       }
 *     ],
 *     "status": "draft",
 *     "current_index": 0,
 *     "created_at": "2023-06-15T10:00:00Z",
 *     "updated_at": "2023-06-15T10:00:00Z"
 *   }
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../modules/socials"
import SocialsService from "../../../modules/socials/service"
import { previewCampaignWorkflow } from "../../../workflows/socials/scheduled-publishing"
import { 
  ContentRule, 
  DEFAULT_CONTENT_RULES,
  CampaignItem,
} from "../../../modules/socials/types/publishing-automation"

/**
 * GET /admin/publishing-campaigns
 * List all publishing campaigns
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  
  const { status, limit = 50, offset = 0 } = req.query as {
    status?: string
    limit?: number
    offset?: number
  }
  
  const filters: any = {}
  if (status) {
    filters.status = status
  }
  
  const campaigns = await socialsService.listPublishingCampaigns(filters, {
    take: Number(limit),
    skip: Number(offset),
    order: { created_at: "DESC" },
  })
  
  // Get count
  const [, count] = await socialsService.listAndCountPublishingCampaigns(filters)
  
  return res.json({
    campaigns,
    count,
    limit: Number(limit),
    offset: Number(offset),
  })
}

/**
 * POST /admin/publishing-campaigns
 * Create a new publishing campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  
  const {
    name,
    product_ids,
    platform_id,
    content_rule,
    interval_hours = 24,
    start_at,
  } = req.body as {
    name: string
    product_ids: string[]
    platform_id: string
    content_rule?: ContentRule
    interval_hours?: number
    start_at?: string
  }
  
  // Validate required fields
  if (!name) {
    return res.status(400).json({ error: "Campaign name is required" })
  }
  if (!product_ids || product_ids.length === 0) {
    return res.status(400).json({ error: "At least one product is required" })
  }
  if (!platform_id) {
    return res.status(400).json({ error: "Platform ID is required" })
  }
  
  // Validate platform exists
  const [platform] = await socialsService.listSocialPlatforms({ id: platform_id })
  if (!platform) {
    return res.status(404).json({ error: "Platform not found" })
  }
  
  const platformName = ((platform as any).name || "").toLowerCase()
  
  // Use default content rule if not provided
  const finalContentRule = content_rule || DEFAULT_CONTENT_RULES[platformName] || DEFAULT_CONTENT_RULES.instagram
  
  // Calculate scheduled times for each product
  const startTime = start_at ? new Date(start_at) : new Date()
  const intervalMs = interval_hours * 60 * 60 * 1000
  
  const items: CampaignItem[] = product_ids.map((productId, index) => {
    const scheduledAt = new Date(startTime.getTime() + (index * intervalMs))
    return {
      product_id: productId,
      position: index,
      scheduled_at: scheduledAt,
      status: "pending" as const,
    }
  })
  
  // Create campaign
  const campaign = await socialsService.createPublishingCampaigns({
    name,
    platform_id,
    content_rule: finalContentRule as any,
    interval_hours,
    items: items as any,
    status: "draft",
    current_index: 0,
  } as any)
  
  return res.status(201).json({ campaign })
}
