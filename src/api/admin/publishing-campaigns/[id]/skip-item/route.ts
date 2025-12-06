import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * POST /admin/publishing-campaigns/:id/skip-item
 * Skip a specific item in the campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  const { item_index } = req.body as { item_index: number }
  
  if (item_index === undefined || item_index < 0) {
    return res.status(400).json({ error: "Valid item_index is required" })
  }
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  const items = campaignData.items || []
  
  if (item_index >= items.length) {
    return res.status(400).json({ error: "Item index out of range" })
  }
  
  const item = items[item_index]
  
  // Only allow skipping pending items
  if (item.status !== "pending") {
    return res.status(400).json({ 
      error: `Cannot skip item with status: ${item.status}` 
    })
  }
  
  // Update item status
  items[item_index].status = "skipped"
  
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    items: items as any,
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: `Item ${item_index} skipped.`,
  })
}
