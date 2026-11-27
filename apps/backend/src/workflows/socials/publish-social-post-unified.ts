import { createWorkflow, WorkflowResponse, transform } from "@medusajs/workflows-sdk"
import {
  loadPostWithPlatformStep,
  validatePlatformStep,
  decryptCredentialsStep,
  detectSmartRetryStep,
  extractTargetAccountsStep,
  extractContentStep,
  determineContentTypeStep,
  validateContentCompatibilityStep,
  routeToPlatformWorkflowStep,
  mergePublishResultsStep,
  updatePostWithResultsStep,
} from "./steps"
import { guardPendingReelStep } from "./steps/guard-pending-reel"
import { startInstagramReelStep } from "./steps/start-instagram-reel"

/**
 * Unified Social Post Publishing Workflow
 * 
 * This workflow handles the complete publishing flow for all platforms:
 * - Facebook, Instagram, Twitter, or both FB+IG
 * - Smart retry logic (only retry failed platforms)
 * - Content validation and compatibility checking
 * - Secure token decryption
 * - Result merging with previous attempts
 * - Post status updates
 * 
 * Benefits:
 * - All business logic in reusable workflow steps
 * - Each step independently testable
 * - Clear separation of concerns
 * - Easy to modify and extend
 * - Secure token management
 */

export type PublishSocialPostUnifiedInput = {
  post_id: string
  override_page_id?: string
  override_ig_user_id?: string
}

export const publishSocialPostUnifiedWorkflow = createWorkflow(
  "publish-social-post-unified",
  (input: PublishSocialPostUnifiedInput) => {
    // Step 1: Load post with platform
    const postData = loadPostWithPlatformStep({ post_id: input.post_id })

    // A Reel still processing must not be published again (double post).
    guardPendingReelStep({ post: postData.post })

    // Step 2: Validate platform
    const platformData = validatePlatformStep({ platform: postData.platform })

    // Step 3: Decrypt credentials
    const credentialsData = decryptCredentialsStep({
      platform: postData.platform,
      platform_name: platformData.platform_name,
    })

    // Step 4: Detect smart retry
    const retryData = detectSmartRetryStep({
      post: postData.post,
      is_fbinsta: platformData.is_fbinsta,
    })

    // Step 5: Extract target accounts
    const targetAccounts = extractTargetAccountsStep({
      post: postData.post,
      override_page_id: input.override_page_id,
      override_ig_user_id: input.override_ig_user_id,
    })

    // Step 6: Extract content
    const contentData = extractContentStep({ post: postData.post })

    // Step 7: Determine content type
    const contentTypeData = determineContentTypeStep({
      media_attachments: contentData.media_attachments,
      caption: contentData.caption,
    })

    // Step 8: Validate content compatibility
    validateContentCompatibilityStep({
      content_type: contentTypeData.content_type,
      publish_target: retryData.publish_target,
      platform_name: platformData.platform_name,
      caption: contentData.caption,
      media_attachments: contentData.media_attachments,
      page_id: targetAccounts.page_id,
      ig_user_id: targetAccounts.ig_user_id,
    })

    // Step 9: Route to platform workflow
    const publishData = routeToPlatformWorkflowStep({
      platform_name: platformData.platform_name,
      post_id: input.post_id,
      page_id: targetAccounts.page_id,
      ig_user_id: targetAccounts.ig_user_id,
      user_access_token: credentialsData.user_access_token,
      publish_target: retryData.publish_target,
      content_type: contentTypeData.content_type,
      caption: contentData.caption,
      image_url: contentTypeData.image_url,
      image_urls: contentTypeData.image_urls,
      video_url: contentTypeData.video_url,
      reel: contentData.reel,
    })

    // Step 10: Merge publish results
    const mergedData = mergePublishResultsStep({
      results: publishData.results,
      previous_results: retryData.previous_results,
    })

    // Step 11: Update post with results
    const finalData = updatePostWithResultsStep({
      post: postData.post,
      merged_results: mergedData.merged_results,
      is_retry: retryData.is_retry,
      platform_name: platformData.platform_name,
      updated_post_from_workflow: publishData.updated_post,
    })

    // Step 12: an Instagram Reel starts its long-running workflow only now,
    // after the post is marked — so no background step can race the marker.
    startInstagramReelStep({ results: publishData.results, post_id: input.post_id })

    return new WorkflowResponse({
      success: finalData.success,
      /** True when the Instagram Reel is still processing; the job finishes it. */
      pending: finalData.pending,
      post: finalData.updated_post,
      results: finalData.results,
      retry_info: finalData.retry_info,
    })
  }
)
