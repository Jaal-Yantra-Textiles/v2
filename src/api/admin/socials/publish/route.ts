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
