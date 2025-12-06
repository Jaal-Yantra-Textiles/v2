import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * POST /admin/publishing-campaigns/:id/start
 * Start a campaign (set status to active)
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow starting draft or preview campaigns
  if (!["draft", "preview", "paused"].includes(campaignData.status)) {
    return res.status(400).json({ 
      error: `Cannot start a campaign with status: ${campaignData.status}` 
    })
  }
  
  // Validate campaign has items
  const items = campaignData.items || []
  if (items.length === 0) {
    return res.status(400).json({ error: "Campaign has no items to publish" })
  }
  
  // If resuming from paused, keep current_index
  // If starting fresh, reset to 0
  const currentIndex = campaignData.status === "paused" 
    ? campaignData.current_index 
    : 0
  
  // Update campaign status
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    status: "active",
    started_at: campaignData.started_at || new Date(),
    paused_at: null,
    current_index: currentIndex,
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: "Campaign started. Items will be published according to schedule.",
  })
}
