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
