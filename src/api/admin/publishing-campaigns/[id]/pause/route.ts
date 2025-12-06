import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * POST /admin/publishing-campaigns/:id/pause
 * Pause an active campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow pausing active campaigns
  if (campaignData.status !== "active") {
    return res.status(400).json({ 
      error: `Cannot pause a campaign with status: ${campaignData.status}` 
    })
  }
  
  // Update campaign status
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    status: "paused",
    paused_at: new Date(),
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: "Campaign paused. Use /start to resume.",
  })
}
