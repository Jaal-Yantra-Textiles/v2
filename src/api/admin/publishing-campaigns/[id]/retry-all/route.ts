import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { processCampaignItemWorkflow } from "../../../../../workflows/socials/scheduled-publishing"
import { CampaignItem } from "../../../../../modules/socials/types/publishing-automation"

/**
 * POST /admin/publishing-campaigns/:id/retry-all
 * Retry all failed items in a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  
  // Get campaign
  const [campaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const items: CampaignItem[] = campaign.items || []
  const failedIndices = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "failed")
    .map(({ index }) => index)
  
  if (failedIndices.length === 0) {
    return res.json({ 
      success: true, 
      message: "No failed items to retry",
      retried: 0,
      succeeded: 0,
      failed: 0,
    })
  }
  
  // Get platform name
  const [platform] = await socialsService.listSocialPlatforms({ id: campaign.platform_id })
  const platformName = (platform as any)?.name || "Unknown"
  
  let succeeded = 0
  let failed = 0
  
  // Process each failed item
  for (const itemIndex of failedIndices) {
    const item = items[itemIndex]
    
    // Update item status to publishing
    items[itemIndex].status = "publishing"
    items[itemIndex].error_message = undefined
    
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
          item_index: itemIndex,
          content_rule: campaign.content_rule,
        },
      })
      
      // Update item with result
      items[itemIndex].status = result.success ? "published" : "failed"
      items[itemIndex].social_post_id = result.social_post_id
      items[itemIndex].published_at = result.success ? new Date() : undefined
      if (!result.success) {
        items[itemIndex].error_message = result.error || "Publishing failed"
        failed++
      } else {
        succeeded++
      }
      
    } catch (error: any) {
      // Mark item as failed again
      items[itemIndex].status = "failed"
      items[itemIndex].error_message = error.message
      failed++
    }
    
    // Update campaign after each item
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
  }
  
  // Refetch campaign for response
  const [updatedCampaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
  
  return res.json({ 
    success: true,
    message: `Retried ${failedIndices.length} items: ${succeeded} succeeded, ${failed} failed`,
    retried: failedIndices.length,
    succeeded,
    failed,
    campaign: updatedCampaign,
  })
}
