import { createStep, StepResponse, createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../modules/socials"
import SocialsService from "../../modules/socials/service"
import type { Logger } from "@medusajs/types"

type ExtractHashtagsMentionsInput = {
  caption: string
  platform_name: string
}

/**
 * Step to extract and store hashtags and mentions from post caption
 */
export const extractHashtagsMentionsStep = createStep(
  "extract-hashtags-mentions",
  async (input: ExtractHashtagsMentionsInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const logger = container.resolve("logger") as Logger

    const { caption, platform_name } = input

    if (!caption) {
      logger.info("[Extract Hashtags/Mentions] No caption provided, skipping extraction")
      return new StepResponse({
        hashtags: [],
        mentions: [],
      })
    }

    logger.info(`[Extract Hashtags/Mentions] Processing caption for platform: ${platform_name}`)

    // Determine platform for storage
    let platform: "facebook" | "instagram" | "twitter" | "all" = "all"
    const lowerPlatform = (platform_name || "all").toLowerCase()
    
    if (lowerPlatform.includes("facebook") && lowerPlatform.includes("instagram")) {
      // FBINSTA - store for both platforms
      platform = "all"
    } else if (lowerPlatform.includes("facebook")) {
      platform = "facebook"
    } else if (lowerPlatform.includes("instagram")) {
      platform = "instagram"
    } else if (lowerPlatform.includes("twitter") || lowerPlatform.includes("x")) {
      platform = "twitter"
    }

    try {
      // Extract and store hashtags
      const hashtags = await socials.extractAndStoreHashtags(caption, platform)
      logger.info(`[Extract Hashtags/Mentions] ✓ Extracted ${hashtags.length} hashtags for ${platform}`)

      // Extract and store mentions (only for specific platforms, not "all")
      let mentions: string[] = []
      if (platform !== "all") {
        mentions = await socials.extractAndStoreMentions(caption, platform)
        logger.info(`[Extract Hashtags/Mentions] ✓ Extracted ${mentions.length} mentions for ${platform}`)
      } else {
        // For FBINSTA, store mentions for both platforms
        const fbMentions = await socials.extractAndStoreMentions(caption, "facebook")
        const igMentions = await socials.extractAndStoreMentions(caption, "instagram")
        mentions = [...new Set([...fbMentions, ...igMentions])]
        logger.info(`[Extract Hashtags/Mentions] ✓ Extracted ${mentions.length} unique mentions for FBINSTA`)
      }

      logger.info(`[Extract Hashtags/Mentions] ✅ Extraction complete - ${hashtags.length} hashtags, ${mentions.length} mentions`)

      return new StepResponse({
        hashtags,
        mentions,
      })
    } catch (error: any) {
      logger.error(`[Extract Hashtags/Mentions] ❌ Extraction failed:`, error)
      // Return empty arrays on error - don't fail the workflow
      return new StepResponse({
        hashtags: [],
        mentions: [],
      })
    }
  }
)

/**
 * Workflow to extract hashtags and mentions from social post
 */
export const extractHashtagsMentionsWorkflow = createWorkflow(
  "extract-hashtags-mentions-workflow",
  (input: ExtractHashtagsMentionsInput) => {
    const result = extractHashtagsMentionsStep(input)
    return new WorkflowResponse(result)
  }
)
