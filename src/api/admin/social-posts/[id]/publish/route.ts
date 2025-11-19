import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { publishSocialPostUnifiedWorkflow } from "../../../../../workflows/socials/publish-social-post-unified"
import type { PublishSocialPostRequest } from "./validators"

/**
 * POST /admin/social-posts/:id/publish
 * 
 * Publish a social media post to configured platforms.
 * 
 * This endpoint delegates all business logic to the unified publishing workflow:
 * - Loads post with platform
 * - Validates platform and credentials (with secure token decryption)
 * - Implements smart retry logic (only retry failed platforms)
 * - Validates content compatibility
 * - Publishes to appropriate platforms (Facebook, Instagram, Twitter, or both)
 * - Merges results with previous attempts
 * - Updates post with results
 * 
 * Request body (optional overrides):
 * - override_page_id: Override Facebook Page ID
 * - override_ig_user_id: Override Instagram User ID
 * 
 * All validation and error handling is done within the workflow.
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
    // Run the unified publishing workflow
    // All business logic (validation, retry, publishing, updates) is handled by the workflow
    const { result } = await publishSocialPostUnifiedWorkflow(req.scope).run({
      input: {
        post_id: postId,
        override_page_id,
        override_ig_user_id,
      },
    })

    // Return the result
    return res.status(200).json({
      success: result.success,
      post: result.post,
      results: result.results,
      retry_info: result.retry_info,
    })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Publishing failed: ${error.message}`
    )
  }
}
