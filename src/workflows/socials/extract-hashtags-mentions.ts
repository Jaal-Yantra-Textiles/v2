import { createStep, StepResponse, createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../modules/socials"
import SocialsService from "../../modules/socials/service"

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

    const { caption, platform_name } = input

    if (!caption) {
      return new StepResponse({
        hashtags: [],
        mentions: [],
      })
    }

    // Determine platform for storage
    let platform: "facebook" | "instagram" | "twitter" | "all" = "all"
    const lowerPlatform = platform_name.toLowerCase()
    
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

    // Extract and store hashtags
    const hashtags = await socials.extractAndStoreHashtags(caption, platform)

    // Extract and store mentions (only for specific platforms, not "all")
    let mentions: string[] = []
    if (platform !== "all") {
      mentions = await socials.extractAndStoreMentions(caption, platform)
    } else {
      // For FBINSTA, store mentions for both platforms
      const fbMentions = await socials.extractAndStoreMentions(caption, "facebook")
      const igMentions = await socials.extractAndStoreMentions(caption, "instagram")
      mentions = [...new Set([...fbMentions, ...igMentions])]
    }

    return new StepResponse({
      hashtags,
      mentions,
    })
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
