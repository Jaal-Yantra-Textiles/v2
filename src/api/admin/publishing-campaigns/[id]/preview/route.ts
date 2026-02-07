/**
 * @file Admin API route for generating previews of publishing campaigns
 * @description Provides endpoints for previewing content in publishing campaigns within the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} CampaignPreviewInput
 * @property {string} name - The name of the campaign
 * @property {string[]} product_ids - Array of product IDs included in the campaign
 * @property {string} platform_id - The ID of the social platform
 * @property {Object} content_rule - Rules for generating content
 * @property {number} interval_hours - Interval between posts in hours
 * @property {string} start_at - ISO timestamp for when the campaign starts
 */

/**
 * @typedef {Object} CampaignPreviewResponse
 * @property {Object} preview - Generated preview content
 * @property {string} preview.text - Preview text content
 * @property {string[]} preview.images - Array of image URLs
 * @property {Object[]} preview.items - Preview items with product details
 * @property {string} preview.items[].product_id - Product ID
 * @property {string} preview.items[].title - Product title
 * @property {string} preview.items[].description - Product description
 * @property {string} preview.items[].image_url - Product image URL
 * @property {string} preview.items[].scheduled_at - Scheduled posting time
 */

/**
 * Generate a preview of all content for a publishing campaign
 * @route POST /admin/publishing-campaigns/:id/preview
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the publishing campaign
 * @returns {CampaignPreviewResponse} 200 - Generated preview content
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error during preview generation
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/preview
 *
 * @example response 200
 * {
 *   "preview": {
 *     "text": "Check out these amazing products!",
 *     "images": [
 *       "https://example.com/image1.jpg",
 *       "https://example.com/image2.jpg"
 *     ],
 *     "items": [
 *       {
 *         "product_id": "prod_123456789",
 *         "title": "Premium Headphones",
 *         "description": "High-quality wireless headphones",
 *         "image_url": "https://example.com/headphones.jpg",
 *         "scheduled_at": "2023-06-15T14:30:00Z"
 *       },
 *       {
 *         "product_id": "prod_987654321",
 *         "title": "Smart Watch",
 *         "description": "Feature-packed smartwatch",
 *         "image_url": "https://example.com/smartwatch.jpg",
 *         "scheduled_at": "2023-06-15T18:30:00Z"
 *       }
 *     ]
 *   }
 * }
 *
 * @example response 404
 * {
 *   "error": "Campaign not found"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { previewCampaignWorkflow } from "../../../../../workflows/socials/scheduled-publishing"

/**
 * POST /admin/publishing-campaigns/:id/preview
 * Generate a preview of all content for a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  const items = campaignData.items || []
  const productIds = items.map((item: any) => item.product_id)
  
  // Run preview workflow
  const { result: preview } = await previewCampaignWorkflow(req.scope).run({
    input: {
      name: campaignData.name,
      product_ids: productIds,
      platform_id: campaignData.platform_id,
      content_rule: campaignData.content_rule,
      interval_hours: campaignData.interval_hours,
      start_at: items[0]?.scheduled_at,
    },
  })
  
  // Update campaign status to preview
  await socialsService.updatePublishingCampaigns({
    id,
    status: "preview",
  } as any)
  
  return res.json({ preview })
}
