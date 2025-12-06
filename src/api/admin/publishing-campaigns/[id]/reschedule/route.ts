import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * POST /admin/publishing-campaigns/:id/reschedule
 * Reschedule remaining items in a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  const { 
    start_at,
    interval_hours,
  } = req.body as { 
    start_at?: string
    interval_hours?: number 
  }
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow rescheduling draft, preview, or paused campaigns
  if (!["draft", "preview", "paused"].includes(campaignData.status)) {
    return res.status(400).json({ 
      error: `Cannot reschedule a campaign with status: ${campaignData.status}` 
    })
  }
  
  const items = campaignData.items || []
  const newIntervalHours = interval_hours || campaignData.interval_hours
  const intervalMs = newIntervalHours * 60 * 60 * 1000
  
  // Find first pending item to use as base time
  const pendingItems = items.filter((i: any) => i.status === "pending")
  if (pendingItems.length === 0) {
    return res.status(400).json({ error: "No pending items to reschedule" })
  }
  
  const startTime = start_at ? new Date(start_at) : new Date()
  
  // Reschedule only pending items
  let pendingIndex = 0
  const updatedItems = items.map((item: any) => {
    if (item.status === "pending") {
      const scheduledAt = new Date(startTime.getTime() + (pendingIndex * intervalMs))
      pendingIndex++
      return { ...item, scheduled_at: scheduledAt }
    }
    return item
  })
  
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    items: updatedItems as any,
    interval_hours: newIntervalHours,
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: `Rescheduled ${pendingItems.length} pending items starting from ${startTime.toISOString()}`,
  })
}
