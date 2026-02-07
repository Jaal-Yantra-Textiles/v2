/**
 * @file Admin API route for publishing content to social media platforms
 * @description Provides endpoints for publishing content to Facebook and Instagram in the JYT Commerce platform
 * @module API/Admin/Socials
 */

/**
 * @typedef {Object} Content
 * @property {"photo" | "video" | "text" | "reel"} type - The type of content to publish
 * @property {string} [message] - Post message (optional)
 * @property {string} [caption] - Instagram caption (optional)
 * @property {string} [image_url] - Image URL for photo posts
 * @property {string} [video_url] - Video URL for video/reel posts
 * @property {string} [link] - Link for Facebook text posts (optional)
 */

/**
 * @typedef {Object} PublishContentRequest
 * @property {"facebook" | "instagram" | "both"} platform - The target platform(s) for publishing
 * @property {string} pageId - Facebook Page ID
 * @property {string} [igUserId] - Instagram Business Account ID (required for Instagram)
 * @property {string} userAccessToken - User access token
 * @property {Content} content - Content to publish
 */

/**
 * @typedef {Object} FacebookPublishResult
 * @property {string} postId - The ID of the published Facebook post
 * @property {string} status - The status of the publication
 * @property {string} [error] - Error message if publication failed
 */

/**
 * @typedef {Object} InstagramPublishResult
 * @property {string} postId - The ID of the published Instagram post
 * @property {string} status - The status of the publication
 * @property {string} [error] - Error message if publication failed
 */

/**
 * @typedef {Object} PublishResponse
 * @property {boolean} success - Whether the operation was successful
 * @property {"facebook" | "instagram" | "both"} platform - The target platform(s)
 * @property {Object} result - The publication result
 * @property {"series" | "unified"} result.mode - The publication mode used
 * @property {FacebookPublishResult} [result.facebook] - Facebook publication result
 * @property {InstagramPublishResult} [result.instagram] - Instagram publication result
 */

/**
 * Publish content to Facebook and/or Instagram
 * @route POST /admin/socials/publish
 * @group Socials - Operations related to social media publishing
 * @param {PublishContentRequest} request.body.required - Content publication data
 * @param {string} [mode=unified] - Publication mode (series or unified)
 * @returns {PublishResponse} 200 - Publication result
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Publishing failed
 *
 * @example request
 * POST /admin/socials/publish?mode=unified
 * {
 *   "platform": "both",
 *   "pageId": "123456789012345",
 *   "igUserId": "987654321098765",
 *   "userAccessToken": "EAACEdEose0cBA...",
 *   "content": {
 *     "type": "photo",
 *     "message": "Check out our new product!",
 *     "caption": "New product alert! 🚀 #JYTCommerce",
 *     "image_url": "https://example.com/product.jpg"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "success": true,
 *   "platform": "both",
 *   "result": {
 *     "mode": "unified",
 *     "facebook": {
 *       "postId": "123456789012345_987654321098765",
 *       "status": "published"
 *     },
 *     "instagram": {
 *       "postId": "178901234567890",
 *       "status": "published"
 *     }
 *   }
 * }
 *
 * @example request - Series mode
 * POST /admin/socials/publish?mode=series
 * {
 *   "platform": "both",
 *   "pageId": "123456789012345",
 *   "igUserId": "987654321098765",
 *   "userAccessToken": "EAACEdEose0cBA...",
 *   "content": {
 *     "type": "video",
 *     "message": "Our latest product demo",
 *     "caption": "Product demo video 🎥",
 *     "video_url": "https://example.com/demo.mp4"
 *   }
 * }
 *
 * @example response 200 - Series mode
 * {
 *   "success": true,
 *   "platform": "both",
 *   "result": {
 *     "mode": "series",
 *     "facebook": {
 *       "postId": "123456789012345_987654321098765",
 *       "status": "published"
 *     },
 *     "instagram": {
 *       "postId": "178901234567890",
 *       "status": "published"
 *     }
 *   }
 * }
 *
 * @example request - Facebook only
 * POST /admin/socials/publish
 * {
 *   "platform": "facebook",
 *   "pageId": "123456789012345",
 *   "userAccessToken": "EAACEdEose0cBA...",
 *   "content": {
 *     "type": "text",
 *     "message": "Visit our website for great deals!",
 *     "link": "https://example.com"
 *   }
 * }
 *
 * @example response 200 - Facebook only
 * {
 *   "success": true,
 *   "platform": "facebook",
 *   "result": {
 *     "mode": "unified",
 *     "facebook": {
 *       "postId": "123456789012345_987654321098765",
 *       "status": "published"
 *     }
 *   }
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { 
  publishToBothPlatformsSeriesWorkflow,
  publishToBothPlatformsUnifiedWorkflow 
} from "../../../../workflows/socials/publish-to-both-platforms"
import { PublishContentSchema, type PublishContentRequest } from "./validators"

/**
 * POST /admin/socials/publish
 * 
 * Publish content to Facebook and/or Instagram
 * 
 * Request body:
 * - platform: "facebook" | "instagram" | "both"
 * - pageId: Facebook Page ID
 * - igUserId: Instagram Business Account ID (required for Instagram)
 * - userAccessToken: User access token
 * - content: Content to publish
 *   - type: "photo" | "video" | "text" | "reel"
 *   - message: Post message (optional)
 *   - caption: Instagram caption (optional)
 *   - image_url: Image URL for photo posts
 *   - video_url: Video URL for video/reel posts
 *   - link: Link for Facebook text posts (optional)
 * 
 * Query parameters:
 * - mode: "series" | "unified" (default: "unified")
 *   - series: Publish to Facebook first, then Instagram
 *   - unified: Publish to both platforms simultaneously
 */
export const POST = async (
  req: MedusaRequest<PublishContentRequest>,
  res: MedusaResponse
) => {
  // Validate request body
  const validation = PublishContentSchema.safeParse(req.body)
  if (!validation.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
    )
  }

  const { platform, pageId, igUserId, userAccessToken, content } = validation.data

  // Determine which workflow to use
  const mode = (req.query.mode as string) || "unified"

  try {
    let result: any

    if (mode === "series") {
      // Use series workflow (Facebook first, then Instagram)
      if (platform !== "both") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Series mode is only available when platform is 'both'"
        )
      }

      const { result: workflowResult } = await publishToBothPlatformsSeriesWorkflow(req.scope).run({
        input: {
          pageId: pageId!,
          igUserId: igUserId!,
          userAccessToken,
          content,
        },
      })

      result = {
        mode: "series",
        facebook: workflowResult.facebook,
        instagram: workflowResult.instagram,
      }
    } else {
      // Use unified workflow (both platforms simultaneously)
      const { result: workflowResult } = await publishToBothPlatformsUnifiedWorkflow(req.scope).run({
        input: {
          pageId: pageId || "",
          igUserId: igUserId || "",
          userAccessToken,
          content,
        },
      })

      result = {
        mode: "unified",
        ...workflowResult,
      }
    }

    res.status(200).json({
      success: true,
      platform,
      result,
    })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Publishing failed: ${error.message}`
    )
  }
}
