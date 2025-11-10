import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { publishToBothPlatformsUnifiedWorkflow } from "../../../../../workflows/socials/publish-to-both-platforms"
import type { PublishSocialPostRequest } from "./validators"

/**
 * POST /admin/social-posts/:id/publish
 * 
 * Publish a social media post to configured platforms
 * 
 * This endpoint:
 * 1. Loads the social post by ID
 * 2. Extracts platform credentials and target accounts from metadata
 * 3. Publishes to configured platforms (Facebook, Instagram, or both)
 * 4. Updates the post with results and URLs
 * 
 * The post must have been created with a social platform that has:
 * - Valid access token in platform.api_config
 * - Target accounts in post.metadata (page_id, ig_user_id)
 * - Publish target in post.metadata (facebook, instagram, or both)
 * 
 * Request body (optional overrides):
 * - override_page_id: Override Facebook Page ID
 * - override_ig_user_id: Override Instagram User ID
 * 
 * Note: Request body validation is handled by middleware
 */
export const POST = async (
  req: MedusaRequest<PublishSocialPostRequest>,
  res: MedusaResponse
) => {
  const postId = req.params.id

  if (!postId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      "Post ID is required"
    )
  }

  // Body is already validated by middleware
  const { override_page_id, override_ig_user_id } = req.validatedBody

  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService

    // Load the social post with platform relation
    const [post] = await socials.listSocialPosts(
      { id: postId },
      { relations: ["platform"] }
    )

    if (!post) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Social post ${postId} not found`
      )
    }

    // Validate platform
    const platform = (post as any).platform
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Post has no associated platform"
      )
    }

    // Extract credentials from platform api_config
    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const userAccessToken = apiConfig.access_token as string | undefined

    if (!userAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No access token found in platform configuration. Please re-authenticate the platform."
      )
    }

    // Extract target accounts from post metadata (with optional overrides)
    const metadata = ((post as any).metadata || {}) as Record<string, any>
    const pageId = override_page_id || (metadata.page_id as string | undefined)
    const igUserId = override_ig_user_id || (metadata.ig_user_id as string | undefined)
    const publishTarget = (metadata.publish_target as "facebook" | "instagram" | "both") || "both"

    // Validate based on publish target
    if ((publishTarget === "facebook" || publishTarget === "both") && !pageId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No Facebook page_id found in post metadata or provided as override"
      )
    }

    if ((publishTarget === "instagram" || publishTarget === "both") && !igUserId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No Instagram ig_user_id found in post metadata or provided as override"
      )
    }

    // Extract content from post
    const mediaAttachments = ((post as any).media_attachments || []) as Array<{
      type: string
      url: string
    }>
    const caption = (post as any).caption || ""

    // Determine content type
    let contentType: "photo" | "video" | "text" | "reel" | "carousel" = "text"
    let imageUrl: string | undefined
    let imageUrls: string[] | undefined
    let videoUrl: string | undefined

    const imageAttachments = mediaAttachments.filter((a) => a.type === "image")
    const videoAttachment = mediaAttachments.find((a) => a.type === "video")

    if (imageAttachments.length > 1) {
      // Multiple images = carousel
      contentType = "carousel"
      imageUrls = imageAttachments.map((a) => a.url)
    } else if (imageAttachments.length === 1) {
      // Single image = photo
      contentType = "photo"
      imageUrl = imageAttachments[0].url
    } else if (videoAttachment) {
      contentType = "reel"
      videoUrl = videoAttachment.url
    } else if (caption) {
      contentType = "text"
    }

    // Validate content type compatibility
    if (contentType === "text" && (publishTarget === "instagram" || publishTarget === "both")) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Text-only posts are not supported on Instagram. Please add media."
      )
    }

    if (contentType === "reel" && publishTarget === "both") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Video/reel posts to both platforms are not yet supported. Please publish to Instagram separately."
      )
    }

    // Run the unified publishing workflow
    const { result } = await publishToBothPlatformsUnifiedWorkflow(req.scope).run({
      input: {
        pageId: pageId || "",
        igUserId: igUserId || "",
        userAccessToken,
        publishTarget,
        content: {
          type: contentType,
          message: caption,
          caption: caption,
          image_url: imageUrl,
          image_urls: imageUrls,
          video_url: videoUrl,
        },
      },
    })

    // Extract results
    const publishResults = result.results || []
    const facebookResult = publishResults.find((r: any) => r.platform === "facebook")
    const instagramResult = publishResults.find((r: any) => r.platform === "instagram")

    // Build post URLs
    let postUrl = (post as any).post_url
    const insights: Record<string, any> = {
      publish_results: publishResults,
      published_at: new Date().toISOString(),
    }

    if (facebookResult?.postId) {
      postUrl = `https://www.facebook.com/${facebookResult.postId}`
      insights.facebook_post_id = facebookResult.postId
    }

    if (instagramResult?.postId) {
      insights.instagram_media_id = instagramResult.postId
      if (instagramResult.permalink) {
        insights.instagram_permalink = instagramResult.permalink
      }
    }

    // Update the post
    const [updatedPost] = await socials.updateSocialPosts([
      {
        selector: { id: postId },
        data: {
          status: result.allSucceeded ? "posted" : "failed",
          posted_at: result.allSucceeded ? new Date() : null,
          post_url: postUrl,
          insights,
          error_message: result.allSucceeded
            ? null
            : publishResults
                .filter((r: any) => !r.success)
                .map((r: any) => `${r.platform}: ${r.error}`)
                .join("; "),
        },
      },
    ])

    res.status(200).json({
      success: result.allSucceeded,
      post: updatedPost,
      results: {
        facebook: facebookResult,
        instagram: instagramResult,
      },
    })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Publishing failed: ${error.message}`
    )
  }
}
