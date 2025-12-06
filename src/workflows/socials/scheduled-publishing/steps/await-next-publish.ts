import { createStep } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Await Next Publish Step (Async/Long-Running)
 * 
 * This step pauses the workflow until it's time to publish the next item.
 * A scheduled job will signal this step when the publish time arrives.
 * 
 * The step can also be signaled to:
 * - Continue (publish now)
 * - Skip (skip this item)
 * - Pause (pause the campaign)
 * - Cancel (cancel the campaign)
 */
export const awaitNextPublishStepId = "await-next-publish"

export const awaitNextPublishStep = createStep(
  {
    name: awaitNextPublishStepId,
    async: true,
    // Timeout after 7 days (max campaign duration between publishes)
    timeout: 60 * 60 * 24 * 7,
    maxRetries: 1,
  },
  async (input: { item_index: number; scheduled_at: string }, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    
    logger.info(`[Campaign] Waiting for publish time...`)
    logger.info(`[Campaign] Item index: ${input.item_index}`)
    logger.info(`[Campaign] Scheduled at: ${input.scheduled_at}`)
    
    // This step will be signaled by the scheduler job when it's time to publish
    // The step doesn't return anything - it just waits
  }
)
