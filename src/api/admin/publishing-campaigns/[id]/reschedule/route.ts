/**
 * @file Admin API route for rescheduling publishing campaigns
 * @description Provides endpoints for rescheduling remaining items in a publishing campaign
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} RescheduleCampaignInput
 * @property {string} [start_at] - The new start time for the campaign in ISO 8601 format. If not provided, the current time is used.
 * @property {number} [interval_hours] - The new interval in hours between scheduled items. If not provided, the existing interval is used.
 */

/**
 * @typedef {Object} CampaignItem
 * @property {string} id - The unique identifier for the campaign item
 * @property {string} status - The status of the item (e.g., "pending", "published", "failed")
 * @property {Date} scheduled_at - The scheduled publication time for the item
 * @property {Object} content - The content details of the item
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier for the campaign
 * @property {string} name - The name of the campaign
 * @property {string} status - The status of the campaign (e.g., "draft", "preview", "paused", "active", "completed")
 * @property {number} interval_hours - The interval in hours between scheduled items
 * @property {Date} created_at - The creation date of the campaign
 * @property {Date} updated_at - The last update date of the campaign
 * @property {CampaignItem[]} items - The list of items in the campaign
 */

/**
 * @typedef {Object} RescheduleCampaignResponse
 * @property {PublishingCampaign} campaign - The updated campaign object
 * @property {string} message - A message indicating the number of items rescheduled and the new start time
 */

/**
 * Reschedule remaining items in a publishing campaign
 * @route POST /admin/publishing-campaigns/:id/reschedule
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to reschedule
 * @param {RescheduleCampaignInput} request.body.required - The rescheduling parameters
 * @returns {RescheduleCampaignResponse} 200 - The updated campaign and a message about the rescheduling
 * @throws {MedusaError} 400 - Invalid input data or campaign status
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/reschedule
 * {
 *   "start_at": "2023-12-01T00:00:00Z",
 *   "interval_hours": 24
 * }
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Winter Sale Campaign",
 *     "status": "paused",
 *     "interval_hours": 24,
 *     "created_at": "2023-11-01T00:00:00Z",
 *     "updated_at": "2023-11-15T00:00:00Z",
 *     "items": [
 *       {
 *         "id": "item_123456789",
 *         "status": "pending",
 *         "scheduled_at": "2023-12-01T00:00:00Z",
 *         "content": {
 *           "title": "Winter Sale",
 *           "description": "Get 50% off on all winter items",
 *           "image_url": "https://example.com/winter-sale.jpg"
 *         }
 *       },
 *       {
 *         "id": "item_987654321",
 *         "status": "pending",
 *         "scheduled_at": "2023-12-02T00:00:00Z",
 *         "content": {
 *           "title": "Winter Sale Day 2",
 *           "description": "Last chance to get 50% off",
 *           "image_url": "https://example.com/winter-sale-day2.jpg"
 *         }
 *       }
 *     ]
 *   },
 *   "message": "Rescheduled 2 pending items starting from 2023-12-01T00:00:00Z"
 * }
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/reschedule
 * {
 *   "interval_hours": 12
 * }
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Winter Sale Campaign",
 *     "status": "paused",
 *     "interval_hours": 12,
 *     "created_at": "2023-11-01T00:00:00Z",
 *     "updated_at": "2023-11-15T00:00:00Z",
 *     "items": [
 *       {
 *         "id": "item_123456789",
 *         "status": "pending",
 *         "scheduled_at": "2023-11-15T12:00:00Z",
 *         "content": {
 *           "title": "Winter Sale",
 *           "description": "Get 50% off on all winter items",
 *           "image_url": "https://example.com/winter-sale.jpg"
 *         }
 *       },
 *       {
 *         "id": "item_987654321",
 *         "status": "pending",
 *         "scheduled_at": "2023-11-16T00:00:00Z",
 *         "content": {
 *           "title": "Winter Sale Day 2",
 *           "description": "Last chance to get 50% off",
 *           "image_url": "https://example.com/winter-sale-day2.jpg"
 *         }
 *       }
 *     ]
 *   },
 *   "message": "Rescheduled 2 pending items starting from 2023-11-15T12:00:00Z"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * POST /admin/publishing-campaigns/:id/reschedule
 * Reschedule remaining items in a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  const { 
    start_at,
    interval_hours,
  } = req.body as { 
    start_at?: string
    interval_hours?: number 
  }
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow rescheduling draft, preview, or paused campaigns
  if (!["draft", "preview", "paused"].includes(campaignData.status)) {
    return res.status(400).json({ 
      error: `Cannot reschedule a campaign with status: ${campaignData.status}` 
    })
  }
  
  const items = campaignData.items || []
  const newIntervalHours = interval_hours || campaignData.interval_hours
  const intervalMs = newIntervalHours * 60 * 60 * 1000
  
  // Find first pending item to use as base time
  const pendingItems = items.filter((i: any) => i.status === "pending")
  if (pendingItems.length === 0) {
    return res.status(400).json({ error: "No pending items to reschedule" })
  }
  
  const startTime = start_at ? new Date(start_at) : new Date()
  
  // Reschedule only pending items
  let pendingIndex = 0
  const updatedItems = items.map((item: any) => {
    if (item.status === "pending") {
      const scheduledAt = new Date(startTime.getTime() + (pendingIndex * intervalMs))
      pendingIndex++
      return { ...item, scheduled_at: scheduledAt }
    }
    return item
  })
  
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    items: updatedItems as any,
    interval_hours: newIntervalHours,
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: `Rescheduled ${pendingItems.length} pending items starting from ${startTime.toISOString()}`,
  })
}
