import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../modules/socials"
import SocialsService from "../modules/socials/service"
import { processCampaignItemWorkflow } from "../workflows/socials/scheduled-publishing"
import { CampaignItem, ContentRule } from "../modules/socials/types/publishing-automation"
import { INotificationModuleService } from "@medusajs/framework/types"

/**
 * Campaign Publisher Job
 * 
 * Runs every 5 minutes to check for campaign items that need to be published.
 * Processes items whose scheduled_at time has passed.
 */

type CampaignRecord = {
  id: string
  name: string
  status: string
  platform_id: string
  content_rule: ContentRule
  items: CampaignItem[]
  current_index: number
  platform?: {
    id: string
    name: string
  }
}

// Helper to send admin notification
async function notifyAdmin(
  container: MedusaContainer,
  title: string,
  description: string
) {
  try {
    const notificationService: INotificationModuleService = container.resolve(Modules.NOTIFICATION)
    await notificationService.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: { title, description },
    })
  } catch (e: any) {
    // Notification failure shouldn't break the job
    const logger = container.resolve("logger")
    logger.warn(`[Campaign Publisher] Failed to send notification: ${e.message}`)
  }
}

export default async function campaignPublisherJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const socialsService: SocialsService = container.resolve(SOCIALS_MODULE)
  
  logger.info("[Campaign Publisher] Checking for items to publish...")
  
  try {
    // Get all active campaigns
    const campaigns = await socialsService.listPublishingCampaigns({
      status: "active",
    }) as unknown as CampaignRecord[]
    
    if (campaigns.length === 0) {
      logger.info("[Campaign Publisher] No active campaigns found")
      return
    }
    
    logger.info(`[Campaign Publisher] Found ${campaigns.length} active campaign(s)`)
    
    const now = new Date()
    
    for (const campaign of campaigns) {
      try {
        await processCampaign(container, campaign, now, logger, socialsService)
      } catch (error: any) {
        logger.error(`[Campaign Publisher] Error processing campaign ${campaign.id}: ${error.message}`)
        
        // Update campaign with error
        await socialsService.updatePublishingCampaigns({
          id: campaign.id,
          error_message: error.message,
        })
        
        // Notify admin about campaign error
        await notifyAdmin(
          container,
          "Campaign Processing Error",
          `Campaign "${campaign.name}" encountered an error: ${error.message}`
        )
      }
    }
    
  } catch (error: any) {
    logger.error(`[Campaign Publisher] Job error: ${error.message}`)
  }
}

async function processCampaign(
  container: MedusaContainer,
  campaign: CampaignRecord,
  now: Date,
  logger: any,
  socialsService: SocialsService
) {
  const items = campaign.items || []
  const currentIndex = campaign.current_index || 0
  
  // Find the next pending item that's due
  let itemToProcess: CampaignItem | null = null
  let itemIndex = -1
  
  for (let i = currentIndex; i < items.length; i++) {
    const item = items[i]
    if (item.status === "pending") {
      const scheduledAt = new Date(item.scheduled_at)
      if (scheduledAt <= now) {
        itemToProcess = item
        itemIndex = i
        break
      }
    }
  }
  
  if (!itemToProcess) {
    // Check if all items are processed
    const allProcessed = items.every(
      (item: CampaignItem) => item.status === "published" || item.status === "failed" || item.status === "skipped"
    )
    
    if (allProcessed && items.length > 0) {
      logger.info(`[Campaign Publisher] Campaign ${campaign.name} completed!`)
      await socialsService.updatePublishingCampaigns({
        id: campaign.id,
        status: "completed",
        completed_at: now,
      })
      
      // Calculate stats for notification
      const published = items.filter((i: CampaignItem) => i.status === "published").length
      const failed = items.filter((i: CampaignItem) => i.status === "failed").length
      
      // Notify admin about campaign completion
      await notifyAdmin(
        container,
        "Campaign Completed",
        `Campaign "${campaign.name}" has completed. ${published} published, ${failed} failed out of ${items.length} items.`
      )
    }
    return
  }
  
  logger.info(`[Campaign Publisher] Processing item ${itemIndex} of campaign ${campaign.name}`)
  logger.info(`[Campaign Publisher] Product: ${itemToProcess.product_id}`)
  
  // Update item status to publishing
  items[itemIndex].status = "publishing"
  await socialsService.updatePublishingCampaigns({
    id: campaign.id,
    items: items as any,
    current_index: itemIndex,
  } as any)
  
  // Get platform name
  const [platform] = await socialsService.listSocialPlatforms({ id: campaign.platform_id })
  const platformName = (platform as any)?.name || "Unknown"
  
  try {
    // Run the publish workflow
    const { result } = await processCampaignItemWorkflow(container).run({
      input: {
        product_id: itemToProcess.product_id,
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
    items[itemIndex].published_at = new Date()
    if (!result.success) {
      items[itemIndex].error_message = result.error || undefined
    }
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
      current_index: itemIndex + 1,
    } as any)
    
    logger.info(`[Campaign Publisher] Item ${itemIndex} ${result.success ? "published" : "failed"}`)
    
  } catch (error: any) {
    logger.error(`[Campaign Publisher] Publish error: ${error.message}`)
    
    // Mark item as failed
    items[itemIndex].status = "failed"
    items[itemIndex].error_message = error.message
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
      current_index: itemIndex + 1,
    } as any)
    
    // Notify admin about item failure
    await notifyAdmin(
      container,
      "Campaign Item Failed",
      `Item ${itemIndex + 1} of campaign "${campaign.name}" failed to publish: ${error.message}`
    )
  }
}

export const config = {
  name: "campaign-publisher",
  schedule: "*/5 * * * *", // Every 5 minutes
}
