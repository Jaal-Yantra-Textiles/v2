import { MedusaError } from "@medusajs/utils"
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import SocialProviderService from "../../modules/social-provider/service"
import type { PublishContentInput, PublishResponse } from "../../modules/social-provider/types"

interface PublishToBothPlatformsInput {
  pageId: string
  igUserId: string
  userAccessToken: string
  publishTarget?: "facebook" | "instagram" | "both"
  content: {
    type: "photo" | "video" | "text" | "reel"
    message?: string
    caption?: string
    image_url?: string
    video_url?: string
    link?: string
  }
}

/**
 * Step: Publish to Facebook
 */
const publishToFacebookStep = createStep(
  "publish-to-facebook",
  async (input: PublishContentInput, { container }) => {
    const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const publisher = socialProvider.getContentPublisher()

    const result = await publisher.publishContent({
      ...input,
      platform: "facebook",
    })

    if (!result.allSucceeded) {
      const error = result.results.find((r) => !r.success)?.error || "Unknown error"
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Facebook publishing failed: ${error}`
      )
    }

    return new StepResponse(result.results[0], {
      postId: result.results[0].postId,
    })
  },
  async (compensateData) => {
    // Rollback: Delete the Facebook post if needed
    // Note: Facebook Graph API doesn't easily support post deletion without additional permissions
    // This is a placeholder for future implementation
    console.log("Rollback: Would delete Facebook post", compensateData?.postId)
  }
)

/**
 * Step: Publish to Instagram
 */
const publishToInstagramStep = createStep(
  "publish-to-instagram",
  async (input: PublishContentInput, { container }) => {
    const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const publisher = socialProvider.getContentPublisher()

    const result = await publisher.publishContent({
      ...input,
      platform: "instagram",
    })

    if (!result.allSucceeded) {
      const error = result.results.find((r) => !r.success)?.error || "Unknown error"
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Instagram publishing failed: ${error}`
      )
    }

    return new StepResponse(result.results[0], {
      postId: result.results[0].postId,
    })
  },
  async (compensateData) => {
    // Rollback: Delete the Instagram post if needed
    // Note: Instagram Graph API supports deletion via DELETE /{media-id}
    // This is a placeholder for future implementation
    console.log("Rollback: Would delete Instagram post", compensateData?.postId)
  }
)

/**
 * Step: Publish to both platforms using unified service
 */
const publishToBothPlatformsStep = createStep(
  "publish-to-both-platforms-unified",
  async (input: PublishContentInput & { publishTarget?: "facebook" | "instagram" | "both" }, { container }) => {
    const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const publisher = socialProvider.getContentPublisher()

    // Determine which platform to publish to
    const targetPlatform = input.publishTarget || "both"

    const result = await publisher.publishContent({
      ...input,
      platform: targetPlatform,
    })

    return new StepResponse(result, {
      results: result.results,
    })
  }
)

/**
 * Workflow: Publish content to both Facebook and Instagram in series
 * 
 * This workflow publishes content to Facebook first, then to Instagram.
 * If Facebook publishing fails, the workflow stops.
 * If Instagram publishing fails, Facebook post remains published.
 */
export const publishToBothPlatformsSeriesWorkflow = createWorkflow(
  "publish-to-both-platforms-series",
  function (input: WorkflowData<PublishToBothPlatformsInput>) {
    // Publish to Facebook first
    const facebookResult = publishToFacebookStep({
      platform: "facebook",
      pageId: input.pageId,
      userAccessToken: input.userAccessToken,
      content: input.content,
    })

    // Then publish to Instagram
    const instagramResult = publishToInstagramStep({
      platform: "instagram",
      pageId: input.pageId,
      igUserId: input.igUserId,
      userAccessToken: input.userAccessToken,
      content: input.content,
    })

    return new WorkflowResponse({
      facebook: facebookResult,
      instagram: instagramResult,
    })
  }
)

/**
 * Workflow: Publish content to both Facebook and Instagram using unified service
 * 
 * This workflow uses the ContentPublishingService to publish to both platforms
 * in a single operation. Both platforms are published simultaneously.
 */
export const publishToBothPlatformsUnifiedWorkflow = createWorkflow(
  "publish-to-both-platforms-unified",
  function (input: WorkflowData<PublishToBothPlatformsInput>) {
    const result = publishToBothPlatformsStep({
      platform: input.publishTarget || "both",
      pageId: input.pageId,
      igUserId: input.igUserId,
      userAccessToken: input.userAccessToken,
      publishTarget: input.publishTarget,
      content: input.content,
    })

    return new WorkflowResponse(result)
  }
)
