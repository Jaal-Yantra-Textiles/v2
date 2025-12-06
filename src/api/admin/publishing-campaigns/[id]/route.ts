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
