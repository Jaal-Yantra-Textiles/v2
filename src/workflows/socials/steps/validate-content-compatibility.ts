import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"

/**
 * Step 8: Validate Content Compatibility
 * 
 * Validates that content is compatible with target platform(s):
 * - Instagram doesn't support text-only posts
 * - Video to both platforms not yet supported
 * - Twitter character limit (280)
 * - Twitter image limit (4 max)
 * - Twitter doesn't support mixing images and videos
 */
export const validateContentCompatibilityStep = createStep(
  "validate-content-compatibility",
  async (input: {
    content_type: string
    publish_target: string
    platform_name: string
    caption: string
    media_attachments: Array<{ type: string; url: string }>
    page_id?: string
    ig_user_id?: string
  }) => {
    // Instagram doesn't support text-only posts
    // Only check this for Instagram or FBINSTA platforms
    const isInstagramPlatform = 
      input.platform_name === "instagram" || 
      input.platform_name === "fbinsta" || 
      input.platform_name === "facebook & instagram"
    
    if (
      input.content_type === "text" &&
      isInstagramPlatform &&
      (input.publish_target === "instagram" || input.publish_target === "both")
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Text-only posts are not supported on Instagram. Please add media."
      )
    }

    // Video to both platforms not yet supported (only for FBINSTA)
    if (input.content_type === "reel" && input.publish_target === "both" && isInstagramPlatform) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Video/reel posts to both platforms are not yet supported. Please publish to Instagram separately."
      )
    }

    // Validate target accounts for Facebook/Instagram
    if (
      input.platform_name === "facebook" ||
      input.platform_name === "instagram" ||
      input.platform_name === "fbinsta" ||
      input.platform_name === "facebook & instagram"
    ) {
      if ((input.publish_target === "facebook" || input.publish_target === "both") && !input.page_id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No Facebook page_id found in post metadata or provided as override"
        )
      }

      if ((input.publish_target === "instagram" || input.publish_target === "both") && !input.ig_user_id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No Instagram ig_user_id found in post metadata or provided as override"
        )
      }
    }

    // Twitter-specific validation
    if (input.platform_name === "twitter" || input.platform_name === "x") {
      // Character limit
      if (input.caption && input.caption.length > 280) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Tweet text exceeds 280 characters (${input.caption.length} characters)`
        )
      }

      // Image limit
      const imageCount = input.media_attachments.filter((a) => a.type === "image").length
      if (imageCount > 4) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Twitter supports maximum 4 images per tweet (${imageCount} provided)`
        )
      }

      // Video + images not supported
      const hasVideo = input.media_attachments.some((a) => a.type === "video")
      const hasImages = imageCount > 0
      if (hasVideo && hasImages) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Twitter does not support mixing images and videos in the same tweet"
        )
      }
    }

    console.log(`[Validate Content Compatibility] ✓ Content is compatible with ${input.platform_name}`)

    return new StepResponse({ validated: true })
  }
)
