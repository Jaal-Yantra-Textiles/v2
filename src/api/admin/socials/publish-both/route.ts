/**
 * @file Admin API route for publishing social posts to both Facebook and Instagram
 * @description Provides a deprecated endpoint for publishing social content to both Facebook and Instagram platforms simultaneously
 * @module API/Admin/Socials
 * @deprecated This module is deprecated. Use the new unified publishing endpoint instead.
 */

/**
 * @typedef {Object} PublishBothRequest
 * @property {string} post_id.required - The ID of the social post to publish
 */

/**
 * @typedef {Object} PublishResult
 * @property {boolean} success - Whether the publication was successful
 * @property {string} [postId] - The ID of the created post on the platform
 * @property {string} [permalink] - The permanent URL to the published post
 * @property {string} [error] - Error message if publication failed
 * @property {string} platform - The platform name ("facebook" or "instagram")
 */

/**
 * @typedef {Object} SocialPost
 * @property {string} id - The unique identifier of the social post
 * @property {string} status - The status of the post (e.g., "posted", "failed")
 * @property {string} [post_url] - URL to the published post
 * @property {Date} [posted_at] - When the post was published
 * @property {Object} [insights] - Analytics and metadata about the post
 * @property {string} [error_message] - Error message if publishing failed
 * @property {string} caption - The caption/content of the post
 * @property {Array<Object>} media_attachments - Media files attached to the post
 * @property {Object} platform - The platform configuration
 * @property {Object} metadata - Additional metadata including target accounts
 */

/**
 * @typedef {Object} PublishBothResponse
 * @property {boolean} success - Whether all publications were successful
 * @property {SocialPost} post - The updated social post object
 * @property {Object} results - Publication results for each platform
 * @property {PublishResult} results.facebook - Facebook publication result
 * @property {PublishResult} results.instagram - Instagram publication result
 * @property {Object} _deprecation - Deprecation information
 * @property {string} _deprecation.message - Deprecation warning message
 * @property {string} _deprecation.sunset_date - When the endpoint will be removed (ISO date)
 * @property {string} _deprecation.alternative - Recommended alternative endpoint
 */

/**
 * Publish a social post to both Facebook and Instagram
 * @route POST /admin/socials/publish-both
 * @group Socials - Operations related to social media publishing
 * @deprecated This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead.
 * @param {PublishBothRequest} request.body.required - Post ID to publish
 * @returns {PublishBothResponse} 200 - Publication results for both platforms
 * @throws {MedusaError} 400 - Invalid input data (missing post_id, invalid platform, etc.)
 * @throws {MedusaError} 404 - Social post not found
 * @throws {MedusaError} 500 - Publishing failed due to server error
 *
 * @example request
 * POST /admin/socials/publish-both
 * {
 *   "post_id": "spost_123456789"
 * }
 *
 * @example response 200
 * {
 *   "success": true,
 *   "post": {
 *     "id": "spost_123456789",
 *     "status": "posted",
 *     "post_url": "https://www.facebook.com/123456789",
 *     "posted_at": "2023-01-01T00:00:00Z",
 *     "insights": {
 *       "facebook_post_id": "123456789",
 *       "instagram_media_id": "987654321",
 *       "instagram_permalink": "https://www.instagram.com/p/ABC123",
 *       "publish_results": [
 *         {
 *           "platform": "facebook",
 *           "success": true,
 *           "postId": "123456789"
 *         },
 *         {
 *           "platform": "instagram",
 *           "success": true,
 *           "postId": "987654321",
 *           "permalink": "https://www.instagram.com/p/ABC123"
 *         }
 *       ],
 *       "published_at": "2023-01-01T00:00:00Z"
 *     },
 *     "caption": "Check out our new product!",
 *     "media_attachments": [
 *       {
 *         "type": "image",
 *         "url": "https://example.com/image.jpg"
 *       }
 *     ],
 *     "platform": {
 *       "name": "Facebook & Instagram",
 *       "api_config": {
 *         "access_token": "EAACEdEose0cBA..."
 *       }
 *     },
 *     "metadata": {
 *       "page_id": "123456789",
 *       "ig_user_id": "987654321",
 *       "publish_target": "both"
 *     }
 *   },
 *   "results": {
 *     "facebook": {
 *       "success": true,
 *       "postId": "123456789",
 *       "platform": "facebook"
 *     },
 *     "instagram": {
 *       "success": true,
 *       "postId": "987654321",
 *       "permalink": "https://www.instagram.com/p/ABC123",
 *       "platform": "instagram"
 *     }
 *   },
 *   "_deprecation": {
 *     "message": "This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead.",
 *     "sunset_date": "2023-04-01T00:00:00Z",
 *     "alternative": "POST /admin/social-posts/:id/publish"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "post_id is required",
 *   "type": "invalid_argument"
 * }
 *
 * @example response 404
 * {
 *   "message": "Social post spost_123456789 not found",
 *   "type": "not_found"
 * }
 *
 * @example response 400 (invalid platform)
 * {
 *   "message": "Platform Twitter is not supported for dual publishing. Use FBINSTA platform.",
 *   "type": "invalid_data"
 * }
 *
 * @example response 400 (missing credentials)
 * {
 *   "message": "No access token found in platform configuration. Please re-authenticate.",
 *   "type": "invalid_data"
 * }
 *
 * @example response 400 (unsupported content type)
 * {
 *   "message": "Text-only posts are not supported on Instagram. Please add media.",
 *   "type": "invalid_data"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import { publishToBothPlatformsUnifiedWorkflow } from "../../../../workflows/socials/publish-to-both-platforms"

/**
 * POST /admin/socials/publish-both
 * 
 * @deprecated This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead.
 * 
 * Publish a social post to both Facebook and Instagram
 * 
 * This endpoint:
 * 1. Loads the social post
 * 2. Extracts platform credentials and target accounts
 * 3. Publishes to both platforms using ContentPublishingService
 * 4. Updates the post with results
 * 
 * **DEPRECATION NOTICE**: This endpoint will be removed in a future version.
 * Please migrate to the new unified publishing endpoint:
 * POST /admin/social-posts/:id/publish
 */
export const POST = async (
  req: MedusaRequest<{ post_id: string }>,
  res: MedusaResponse
) => {
  // Log deprecation warning
  console.warn(
    "[DEPRECATED] POST /admin/socials/publish-both is deprecated. " +
    "Use POST /admin/social-posts/:id/publish instead. " +
    "This endpoint will be removed in a future version."
  )

  const { post_id } = req.body

  if (!post_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      "post_id is required"
    )
  }

  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService

    // Load the social post with platform relation
    const [post] = await socials.listSocialPosts(
      { id: post_id },
      { relations: ["platform"] }
    )

    if (!post) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Social post ${post_id} not found`
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
    if (platformName !== "fbinsta" && platformName !== "facebook & instagram") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Platform ${platform.name} is not supported for dual publishing. Use FBINSTA platform.`
      )
    }

    // Extract credentials from platform api_config
    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const userAccessToken = apiConfig.access_token as string | undefined

    if (!userAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No access token found in platform configuration. Please re-authenticate."
      )
    }

    // Extract target accounts from post metadata
    const metadata = ((post as any).metadata || {}) as Record<string, any>
    const pageId = metadata.page_id as string | undefined
    const igUserId = metadata.ig_user_id as string | undefined
    const publishTarget = (metadata.publish_target as "facebook" | "instagram" | "both") || "both"

    // Validate based on publish target
    if ((publishTarget === "facebook" || publishTarget === "both") && !pageId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No Facebook page_id found in post metadata"
      )
    }

    if ((publishTarget === "instagram" || publishTarget === "both") && !igUserId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No Instagram ig_user_id found in post metadata"
      )
    }

    // Extract content from post
    const mediaAttachments = ((post as any).media_attachments || []) as Array<{
      type: string
      url: string
    }>
    const caption = (post as any).caption || ""

    // Determine content type
    let contentType: "photo" | "video" | "text" | "reel" = "text"
    let imageUrl: string | undefined
    let videoUrl: string | undefined

    const imageAttachment = mediaAttachments.find((a) => a.type === "image")
    const videoAttachment = mediaAttachments.find((a) => a.type === "video")

    if (imageAttachment) {
      contentType = "photo"
      imageUrl = imageAttachment.url
    } else if (videoAttachment) {
      contentType = "reel"
      videoUrl = videoAttachment.url
    } else if (caption) {
      contentType = "text"
    }

    // Validate content type compatibility
    if (contentType === "text") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Text-only posts are not supported on Instagram. Please add media."
      )
    }

    if (contentType === "reel") {
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
        publishTarget, // Pass the target selection
        content: {
          type: contentType,
          message: caption,
          caption: caption,
          image_url: imageUrl,
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
    
    // Preserve existing insights data
    const currentInsights = ((post as any).insights as Record<string, unknown>) || {}
    const insights: Record<string, any> = {
      ...currentInsights,  // Preserve existing webhook data
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
        selector: { id: post_id },
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

    // Add deprecation header
    res.setHeader(
      "Deprecation",
      "true"
    )
    res.setHeader(
      "Sunset",
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString() // 90 days from now
    )
    res.setHeader(
      "Link",
      '</admin/social-posts/:id/publish>; rel="alternate"'
    )

    res.status(200).json({
      success: result.allSucceeded,
      post: updatedPost,
      results: {
        facebook: facebookResult,
        instagram: instagramResult,
      },
      _deprecation: {
        message: "This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead.",
        sunset_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        alternative: "POST /admin/social-posts/:id/publish",
      },
    })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Publishing failed: ${error.message}`
    )
  }
}
