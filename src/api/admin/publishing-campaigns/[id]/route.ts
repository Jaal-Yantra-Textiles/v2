/**
 * @file Admin API routes for managing publishing campaigns
 * @description Provides endpoints for retrieving, updating, and deleting publishing campaigns in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier of the campaign
 * @property {string} name - The name of the campaign
 * @property {string} status - The status of the campaign (draft, active, paused, completed)
 * @property {string} platform_id - The ID of the social platform
 * @property {Object} content_rule - The content rule configuration
 * @property {number} interval_hours - The interval in hours between publications
 * @property {Array<Object>} items - The list of items to be published
 * @property {Date} created_at - When the campaign was created
 * @property {Date} updated_at - When the campaign was last updated
 */

/**
 * @typedef {Object} SocialPlatform
 * @property {string} id - The unique identifier of the platform
 * @property {string} name - The name of the platform (e.g., Facebook, Instagram)
 * @property {string} type - The type of platform
 * @property {Object} config - Platform-specific configuration
 */

/**
 * @typedef {Object} CampaignStats
 * @property {number} total - Total number of items in the campaign
 * @property {number} published - Number of published items
 * @property {number} failed - Number of failed items
 * @property {number} pending - Number of pending items
 * @property {number} skipped - Number of skipped items
 */

/**
 * @typedef {Object} CampaignResponse
 * @property {string} id - The unique identifier of the campaign
 * @property {string} name - The name of the campaign
 * @property {string} status - The status of the campaign
 * @property {SocialPlatform} platform - The associated social platform details
 * @property {Object} content_rule - The content rule configuration
 * @property {number} interval_hours - The interval in hours between publications
 * @property {Array<Object>} items - The list of items to be published
 * @property {CampaignStats} stats - Statistics about the campaign items
 * @property {Date} next_publish_at - The scheduled time for the next publication
 * @property {Date} created_at - When the campaign was created
 * @property {Date} updated_at - When the campaign was last updated
 */

/**
 * @typedef {Object} UpdateCampaignInput
 * @property {string} [name] - The name of the campaign
 * @property {Object} [content_rule] - The content rule configuration
 * @property {number} [interval_hours] - The interval in hours between publications
 * @property {Array<Object>} [items] - The list of items to be published
 */

/**
 * Get a single publishing campaign with details
 * @route GET /admin/publishing-campaigns/:id
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to retrieve
 * @returns {CampaignResponse} 200 - The campaign object with platform details and statistics
 * @throws {MedusaError} 404 - Campaign not found
 *
 * @example request
 * GET /admin/publishing-campaigns/camp_123456789
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Summer Sale Campaign",
 *     "status": "active",
 *     "platform": {
 *       "id": "plat_987654321",
 *       "name": "Facebook",
 *       "type": "social",
 *       "config": {}
 *     },
 *     "content_rule": {
 *       "type": "product",
 *       "filter": "collection:summer-2023"
 *     },
 *     "interval_hours": 24,
 *     "items": [
 *       {
 *         "id": "item_111111111",
 *         "status": "published",
 *         "scheduled_at": "2023-06-01T10:00:00Z"
 *       },
 *       {
 *         "id": "item_222222222",
 *         "status": "pending",
 *         "scheduled_at": "2023-06-02T10:00:00Z"
 *       }
 *     ],
 *     "stats": {
 *       "total": 2,
 *       "published": 1,
 *       "failed": 0,
 *       "pending": 1,
 *       "skipped": 0
 *     },
 *     "next_publish_at": "2023-06-02T10:00:00Z",
 *     "created_at": "2023-05-01T00:00:00Z",
 *     "updated_at": "2023-05-15T12:30:00Z"
 *   }
 * }
 */

/**
 * Update a publishing campaign
 * @route PUT /admin/publishing-campaigns/:id
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to update
 * @param {UpdateCampaignInput} request.body.required - Campaign data to update
 * @returns {PublishingCampaign} 200 - The updated campaign object
 * @throws {MedusaError} 400 - Can only update draft or paused campaigns
 * @throws {MedusaError} 404 - Campaign not found
 *
 * @example request
 * PUT /admin/publishing-campaigns/camp_123456789
 * {
 *   "name": "Updated Summer Sale Campaign",
 *   "interval_hours": 12,
 *   "items": [
 *     {
 *       "id": "item_111111111",
 *       "status": "published",
 *       "scheduled_at": "2023-06-01T10:00:00Z"
 *     },
 *     {
 *       "id": "item_333333333",
 *       "status": "pending",
 *       "scheduled_at": "2023-06-02T10:00:00Z"
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Updated Summer Sale Campaign",
 *     "status": "draft",
 *     "platform_id": "plat_987654321",
 *     "content_rule": {
 *       "type": "product",
 *       "filter": "collection:summer-2023"
 *     },
 *     "interval_hours": 12,
 *     "items": [
 *       {
 *         "id": "item_111111111",
 *         "status": "published",
 *         "scheduled_at": "2023-06-01T10:00:00Z"
 *       },
 *       {
 *         "id": "item_333333333",
 *         "status": "pending",
 *         "scheduled_at": "2023-06-02T10:00:00Z"
 *       }
 *     ],
 *     "created_at": "2023-05-01T00:00:00Z",
 *     "updated_at": "2023-05-20T14:45:00Z"
 *   }
 * }
 */

/**
 * Delete a publishing campaign
 * @route DELETE /admin/publishing-campaigns/:id
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to delete
 * @returns {Object} 200 - Success confirmation
 * @throws {MedusaError} 400 - Cannot delete an active campaign. Pause or cancel it first.
 * @throws {MedusaError} 404 - Campaign not found
 *
 * @example request
 * DELETE /admin/publishing-campaigns/camp_123456789
 *
 * @example response 200
 * {
 *   "success": true
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/publishing-campaigns/:id
 * Get a single campaign with details
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  // Get platform details
  const [platform] = await socialsService.listSocialPlatforms({ 
    id: (campaign as any).platform_id 
  })
  
  // Calculate stats
  const items = (campaign as any).items || []
  const stats = {
    total: items.length,
    published: items.filter((i: any) => i.status === "published").length,
    failed: items.filter((i: any) => i.status === "failed").length,
    pending: items.filter((i: any) => i.status === "pending").length,
    skipped: items.filter((i: any) => i.status === "skipped").length,
  }
  
  // Find next scheduled item
  const nextItem = items.find((i: any) => i.status === "pending")
  
  return res.json({
    campaign: {
      ...campaign,
      platform,
      stats,
      next_publish_at: nextItem?.scheduled_at,
    },
  })
}

/**
 * PUT /admin/publishing-campaigns/:id
 * Update a campaign
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [existing] = await socialsService.listPublishingCampaigns({ id })
  if (!existing) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  // Only allow updates to draft campaigns
  if ((existing as any).status !== "draft" && (existing as any).status !== "paused") {
    return res.status(400).json({ 
      error: "Can only update draft or paused campaigns" 
    })
  }
  
  const {
    name,
    content_rule,
    interval_hours,
    items,
  } = req.body as {
    name?: string
    content_rule?: any
    interval_hours?: number
    items?: any[]
  }
  
  const updateData: any = {}
  if (name) updateData.name = name
  if (content_rule) updateData.content_rule = content_rule
  if (interval_hours) updateData.interval_hours = interval_hours
  if (items) updateData.items = items
  
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    ...updateData,
  } as any)
  
  return res.json({ campaign: updated })
}

/**
 * DELETE /admin/publishing-campaigns/:id
 * Delete a campaign
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [existing] = await socialsService.listPublishingCampaigns({ id })
  if (!existing) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  // Don't allow deleting active campaigns
  if ((existing as any).status === "active") {
    return res.status(400).json({ 
      error: "Cannot delete an active campaign. Pause or cancel it first." 
    })
  }
  
  await socialsService.deletePublishingCampaigns(id)
  
  return res.json({ success: true })
}
