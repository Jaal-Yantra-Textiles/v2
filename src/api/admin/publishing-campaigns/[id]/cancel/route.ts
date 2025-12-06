import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * POST /admin/publishing-campaigns/:id/cancel
 * Cancel a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow cancelling active or paused campaigns
  if (!["active", "paused", "draft", "preview"].includes(campaignData.status)) {
    return res.status(400).json({ 
      error: `Cannot cancel a campaign with status: ${campaignData.status}` 
    })
  }
  
  // Mark remaining pending items as skipped
  const items = campaignData.items || []
  const updatedItems = items.map((item: any) => {
    if (item.status === "pending") {
      return { ...item, status: "skipped" }
    }
    return item
  })
  
  // Update campaign status
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    status: "cancelled",
    items: updatedItems as any,
    completed_at: new Date(),
  } as any)
  
  const skippedCount = updatedItems.filter((i: any) => i.status === "skipped").length
  
  return res.json({ 
    campaign: updated,
    message: `Campaign cancelled. ${skippedCount} pending items were skipped.`,
  })
}
