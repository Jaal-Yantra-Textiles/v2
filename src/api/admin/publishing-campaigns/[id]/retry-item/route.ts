import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { processCampaignItemWorkflow } from "../../../../../workflows/socials/scheduled-publishing"
import { CampaignItem } from "../../../../../modules/socials/types/publishing-automation"

/**
 * POST /admin/publishing-campaigns/:id/retry-item
 * Retry a failed campaign item
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const { item_index } = req.body as { item_index: number }
  
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  
  // Get campaign
  const [campaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  // Validate item index
  const items: CampaignItem[] = campaign.items || []
  if (item_index < 0 || item_index >= items.length) {
    return res.status(400).json({ error: "Invalid item index" })
  }
  
  const item = items[item_index]
  
  // Only allow retry for failed items
  if (item.status !== "failed") {
    return res.status(400).json({ 
      error: `Cannot retry item with status "${item.status}". Only failed items can be retried.` 
    })
  }
  
  // Get platform name
  const [platform] = await socialsService.listSocialPlatforms({ id: campaign.platform_id })
  const platformName = (platform as any)?.name || "Unknown"
  
  // Update item status to publishing
  items[item_index].status = "publishing"
  items[item_index].error_message = undefined
  
  await socialsService.updatePublishingCampaigns({
    id: campaign.id,
    items: items as any,
  } as any)
  
  try {
    // Run the publish workflow
    const { result } = await processCampaignItemWorkflow(req.scope).run({
      input: {
        product_id: item.product_id,
        platform_id: campaign.platform_id,
        platform_name: platformName,
        campaign_name: campaign.name,
        campaign_id: campaign.id,
        item_index: item_index,
        content_rule: campaign.content_rule,
      },
    })
    
    // Update item with result
    items[item_index].status = result.success ? "published" : "failed"
    items[item_index].social_post_id = result.social_post_id
    items[item_index].published_at = result.success ? new Date() : undefined
    if (!result.success) {
      items[item_index].error_message = result.error || "Publishing failed"
    }
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
    
    // Refetch campaign for response
    const [updatedCampaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
    
    return res.json({ 
      success: result.success,
      campaign: updatedCampaign,
      item: items[item_index],
    })
    
  } catch (error: any) {
    // Mark item as failed again
    items[item_index].status = "failed"
    items[item_index].error_message = error.message
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
    
    return res.status(500).json({ 
      success: false,
      error: error.message,
    })
  }
}
