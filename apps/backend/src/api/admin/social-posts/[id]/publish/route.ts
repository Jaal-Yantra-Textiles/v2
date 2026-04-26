/**
 * @file Admin API route for publishing social media posts
 * @description Provides endpoints for publishing social media posts to configured platforms
 * @module API/Admin/SocialPosts
 */

/**
 * @typedef {Object} PublishSocialPostRequest
 * @property {string} [override_page_id] - Optional override for Facebook Page ID
 * @property {string} [override_ig_user_id] - Optional override for Instagram User ID
 */

/**
 * @typedef {Object} SocialPostResult
 * @property {string} platform - The social media platform (facebook, instagram, twitter)
 * @property {boolean} success - Whether the publication was successful
 * @property {string} [post_id] - The ID of the created post on the platform
 * @property {string} [error] - Error message if publication failed
 */

/**
 * @typedef {Object} RetryInfo
 * @property {boolean} should_retry - Whether a retry is recommended
 * @property {string[]} failed_platforms - List of platforms that failed
 * @property {number} retry_after_seconds - Recommended delay before retry
 */

/**
 * @typedef {Object} PublishSocialPostResponse
 * @property {boolean} success - Overall success status
 * @property {Object} post - The updated social post object
 * @property {string} post.id - The post ID
 * @property {string} post.title - The post title
 * @property {string} post.content - The post content
 * @property {string} post.status - The post status (published, failed, etc.)
 * @property {Date} post.scheduled_at - When the post was scheduled
 * @property {Date} post.published_at - When the post was published
 * @property {SocialPostResult[]} results - Publication results for each platform
 * @property {RetryInfo} retry_info - Retry information if applicable
 */

/**
 * Publish a social media post to configured platforms
 *
 * This endpoint delegates all business logic to the unified publishing workflow:
 * - Loads post with platform configuration
 * - Validates platform credentials (with secure token decryption)
 * - Implements smart retry logic (only retry failed platforms)
 * - Validates content compatibility with each platform
 * - Publishes to appropriate platforms (Facebook, Instagram, Twitter, or combinations)
 * - Merges results with previous publication attempts
 * - Updates the post record with publication results
 *
 * @route POST /admin/social-posts/:id/publish
 * @group SocialPost - Operations related to social media posts
 * @param {string} id.path.required - The ID of the social post to publish
 * @param {PublishSocialPostRequest} request.body - Optional platform ID overrides
 * @returns {PublishSocialPostResponse} 200 - Publication results and updated post
 * @throws {MedusaError} 400 - Invalid post ID or request body
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Post not found
 * @throws {MedusaError} 500 - Publishing failed due to platform errors
 *
 * @example request
 * POST /admin/social-posts/post_123456789/publish
 * {
 *   "override_page_id": "fb_page_987654321",
 *   "override_ig_user_id": "ig_user_123456789"
 * }
 *
 * @example response 200
 * {
 *   "success": true,
 *   "post": {
 *     "id": "post_123456789",
 *     "title": "Summer Sale Announcement",
 *     "content": "Check out our amazing summer deals!",
 *     "status": "published",
 *     "scheduled_at": "2023-06-15T09:00:00Z",
 *     "published_at": "2023-06-15T09:00:15Z"
 *   },
 *   "results": [
 *     {
 *       "platform": "facebook",
 *       "success": true,
 *       "post_id": "fb_post_987654321"
 *     },
 *     {
 *       "platform": "instagram",
 *       "success": true,
 *       "post_id": "ig_post_123456789"
 *     }
 *   ],
 *   "retry_info": {
 *     "should_retry": false,
 *     "failed_platforms": [],
 *     "retry_after_seconds": 0
 *   }
 * }
 *
 * @example response 200 (partial failure)
 * {
 *   "success": false,
 *   "post": {
 *     "id": "post_123456789",
 *     "title": "Summer Sale Announcement",
 *     "content": "Check out our amazing summer deals!",
 *     "status": "partially_published",
 *     "scheduled_at": "2023-06-15T09:00:00Z",
 *     "published_at": "2023-06-15T09:00:15Z"
 *   },
 *   "results": [
 *     {
 *       "platform": "facebook",
 *       "success": true,
 *       "post_id": "fb_post_987654321"
 *     },
 *     {
 *       "platform": "instagram",
 *       "success": false,
 *       "error": "Invalid media format"
 *     }
 *   ],
 *   "retry_info": {
 *     "should_retry": true,
 *     "failed_platforms": ["instagram"],
 *     "retry_after_seconds": 300
 *   }
 * }
 */
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
