import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { ScheduledPublishingInput, CampaignWorkflowState } from "../types"
import { CampaignItem } from "../../../../modules/socials/types/publishing-automation"

/**
 * Initialize Campaign Step
 * 
 * Sets up the campaign state with all items and their scheduled times.
 * Validates platform exists and calculates publish schedule.
 */
export const initializeCampaignStep = createStep(
  "initialize-campaign",
  async (input: ScheduledPublishingInput, { container, context }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const socialsService = container.resolve(SOCIALS_MODULE)
    
    logger.info(`[Campaign] Initializing campaign: ${input.name}`)
    logger.info(`[Campaign] Products: ${input.product_ids.length}, Platform: ${input.platform_id}`)
    
    // Validate platform exists
    const [platform] = await socialsService.listSocialPlatforms({ id: input.platform_id })
    if (!platform) {
      throw new Error(`Platform not found: ${input.platform_id}`)
    }
    
    const platformName = (platform as any).name || "Unknown"
    
    // Calculate scheduled times for each product
    const startTime = input.start_at ? new Date(input.start_at) : new Date()
    const intervalMs = input.interval_hours * 60 * 60 * 1000
    
    const items: CampaignItem[] = input.product_ids.map((productId, index) => {
      const scheduledAt = new Date(startTime.getTime() + (index * intervalMs))
      
      return {
        product_id: productId,
        position: index,
        scheduled_at: scheduledAt,
        status: "pending" as const,
      }
    })
    
    const state: CampaignWorkflowState = {
      name: input.name,
      platform_id: input.platform_id,
      platform_name: platformName,
      content_rule: input.content_rule,
      interval_hours: input.interval_hours,
      status: "active",
      items,
      current_index: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      paused_at: null,
    }
    
    logger.info(`[Campaign] Initialized with ${items.length} items`)
    logger.info(`[Campaign] First publish at: ${items[0]?.scheduled_at}`)
    logger.info(`[Campaign] Last publish at: ${items[items.length - 1]?.scheduled_at}`)
    logger.info(`[Campaign] Transaction ID: ${context.transactionId}`)
    
    return new StepResponse(state)
  }
)
