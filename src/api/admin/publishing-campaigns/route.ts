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
