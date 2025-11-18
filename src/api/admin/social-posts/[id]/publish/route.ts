import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { publishToBothPlatformsUnifiedWorkflow } from "../../../../../workflows/socials/publish-to-both-platforms"
import { publishSocialPostWorkflow } from "../../../../../workflows/socials/publish-post"
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

    const platformName = (platform.name || "").toLowerCase()
    const isFBINSTA = platformName === "fbinsta" || platformName === "facebook & instagram"

    // Check for previous publish attempts and detect failures
    const currentInsights = ((post as any).insights as Record<string, unknown>) || {}
    const previousResults = (currentInsights.publish_results as any[]) || []
    
    // Detect which platforms previously failed
    const facebookPreviouslyFailed = previousResults.some(
      (r: any) => r.platform === "facebook" && !r.success
    )
    const instagramPreviouslyFailed = previousResults.some(
      (r: any) => r.platform === "instagram" && !r.success
    )
    const facebookPreviouslySucceeded = previousResults.some(
      (r: any) => r.platform === "facebook" && r.success
    )
    const instagramPreviouslySucceeded = previousResults.some(
      (r: any) => r.platform === "instagram" && r.success
    )

    // Extract credentials from platform api_config
    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const userAccessToken = apiConfig.access_token as string | undefined

    if (!userAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No access token found in platform configuration. Please re-authenticate the platform."
      )
    }

    // Twitter-specific validation
    if (platformName === "twitter" || platformName === "x") {
      const oauth1UserCreds = apiConfig.oauth1_credentials
      const oauth1AppCreds = apiConfig.oauth1_app_credentials || apiConfig.app_credentials
      
      // Check if we have either OAuth 1.0a user credentials OR app-level OAuth 1.0a credentials
      const hasUserOAuth1 = oauth1UserCreds?.access_token && oauth1UserCreds?.access_token_secret
      const hasAppOAuth1 = (oauth1AppCreds?.consumer_key || oauth1AppCreds?.api_key) && 
                           (oauth1AppCreds?.consumer_secret || oauth1AppCreds?.api_secret)
      
      if (!hasUserOAuth1 && !hasAppOAuth1) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Twitter requires authentication. Please click 'App-only access' button in platform settings or complete OAuth flow."
        )
      }
    }

    // Extract target accounts from post metadata (with optional overrides)
    const metadata = ((post as any).metadata || {}) as Record<string, any>
    const pageId = override_page_id || (metadata.page_id as string | undefined)
    const igUserId = override_ig_user_id || (metadata.ig_user_id as string | undefined)
    let publishTarget = (metadata.publish_target as "facebook" | "instagram" | "both") || "both"
    
    // Smart retry: If this is a retry and one platform succeeded, only retry the failed one
    if (isFBINSTA && publishTarget === "both") {
      if (facebookPreviouslySucceeded && instagramPreviouslyFailed) {
        publishTarget = "instagram"
        console.log("🔄 Smart retry: Publishing only to Instagram (Facebook already succeeded)")
      } else if (instagramPreviouslySucceeded && facebookPreviouslyFailed) {
        publishTarget = "facebook"
        console.log("🔄 Smart retry: Publishing only to Facebook (Instagram already succeeded)")
      }
    }

    // Validate based on publish target (only for Facebook/Instagram platforms)
    if (platformName === "facebook" || platformName === "instagram" || isFBINSTA) {
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

    // Twitter-specific validation
    if (platformName === "twitter" || platformName === "x") {
      // Character limit
      if (caption && caption.length > 280) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Tweet text exceeds 280 characters (${caption.length} characters)`
        )
      }

      // Image limit
      if (imageAttachments.length > 4) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Twitter supports maximum 4 images per tweet (${imageAttachments.length} provided)`
        )
      }

      // Video + images not supported
      if (videoAttachment && imageAttachments.length > 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Twitter does not support mixing images and videos in the same tweet"
        )
      }
    }

    // Run the appropriate workflow based on platform
    if (platformName === "twitter" || platformName === "x") {
      // Use the Twitter-specific workflow (it handles the post update internally)
      const { result: twitterPost } = await publishSocialPostWorkflow(req.scope).run({
        input: {
          post_id: postId,
        },
      })
      
      // Twitter workflow returns the updated post directly - return it immediately
      return res.status(200).json({
        success: (twitterPost as any).status === "posted",
        post: twitterPost,
        results: {
          twitter: twitterPost,
        },
      })
    }
    
    // Facebook/Instagram publishing workflow
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
    let postUrl = (post as any).post_url
    
    // Merge new results with previous results (for retry scenarios)
    const mergedResults = [...previousResults]
    
    // Replace or add new results
    publishResults.forEach((newResult: any) => {
      const existingIndex = mergedResults.findIndex(
        (r: any) => r.platform === newResult.platform
      )
      if (existingIndex >= 0) {
        // Replace previous result for this platform
        mergedResults[existingIndex] = newResult
      } else {
        // Add new result
        mergedResults.push(newResult)
      }
    })
    
    const insights: Record<string, any> = {
      ...currentInsights,  // Preserve existing webhook data
      publish_results: mergedResults,  // Use merged results
      published_at: new Date().toISOString(),
      last_retry_at: previousResults.length > 0 ? new Date().toISOString() : undefined,
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

    // Determine overall success based on merged results
    const allPlatformsSucceeded = mergedResults.every((r: any) => r.success)
    const anyPlatformFailed = mergedResults.some((r: any) => !r.success)
    
    // Update the post
    const [updatedPost] = await socials.updateSocialPosts([
      {
        selector: { id: postId },
        data: {
          status: allPlatformsSucceeded ? "posted" : "failed",
          posted_at: allPlatformsSucceeded ? new Date() : null,
          post_url: postUrl,
          insights,
          error_message: anyPlatformFailed
            ? mergedResults
                .filter((r: any) => !r.success)
                .map((r: any) => `${r.platform}: ${r.error}`)
                .join("; ")
            : null,
        },
      },
    ])

    res.status(200).json({
      success: allPlatformsSucceeded,
      post: updatedPost,
      results: {
        facebook: facebookResult || mergedResults.find((r: any) => r.platform === "facebook"),
        instagram: instagramResult || mergedResults.find((r: any) => r.platform === "instagram"),
      },
      retry_info: previousResults.length > 0 ? {
        is_retry: true,
        previous_attempts: previousResults.length,
        retried_platform: publishTarget !== "both" ? publishTarget : null,
      } : undefined,
    })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Publishing failed: ${error.message}`
    )
  }
}
