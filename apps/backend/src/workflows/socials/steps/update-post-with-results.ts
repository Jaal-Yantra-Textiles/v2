import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { SOCIALS_MODULE } from "../../../modules/socials"
import SocialsService from "../../../modules/socials/service"

/**
 * Step 11: Update Post with Results
 * 
 * Updates the social post with publish results:
 * - Sets status (posted/failed) based on all platform results
 * - Stores publish results in insights
 * - Sets post URLs (Facebook, Instagram permalinks)
 * - Records error messages for failed publishes
 * - Tracks retry attempts
 * 
 * Special case: Twitter workflow already updates the post, so we return it directly.
 */
export const updatePostWithResultsStep = createStep(
  "update-post-with-results",
  async (
    input: {
      post: any
      merged_results: any[]
      is_retry: boolean
      platform_name: string
      updated_post_from_workflow?: any // Twitter workflow returns updated post
    },
    { container }
  ) => {
    // If Twitter workflow already updated the post, return it
    if (input.updated_post_from_workflow) {
      console.log(`[Update Post] ✓ Using post updated by Twitter workflow`)
      
      return new StepResponse({
        pending: false,
        updated_post: input.updated_post_from_workflow,
        success: (input.updated_post_from_workflow as any).status === "posted",
        results: {
          twitter: input.updated_post_from_workflow,
          facebook: undefined,
          instagram: undefined,
        } as any,
        retry_info: input.is_retry ? {
          is_retry: true,
          previous_attempts: input.merged_results.length,
        } : undefined,
      })
    }

    // For Facebook/Instagram, update the post ourselves
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    // An Instagram Reel still processing is PENDING, not failed: the
    // finish-instagram-reels job publishes it and settles the post.
    const isPending = (r: any) => r.platform === "instagram" && r.pending === true
    const pendingReel = input.merged_results.find(isPending)
    const allSucceeded = input.merged_results.every((r: any) => r.success)
    const anyFailed = input.merged_results.some((r: any) => !r.success && !isPending(r))

    const facebookResult = input.merged_results.find((r: any) => r.platform === "facebook")
    const instagramResult = input.merged_results.find((r: any) => r.platform === "instagram")

    let postUrl = input.post.post_url
    const currentInsights = (input.post.insights as Record<string, unknown>) || {}
    const insights: Record<string, any> = {
      ...currentInsights,
      publish_results: input.merged_results,
      published_at: new Date().toISOString(),
      last_retry_at: input.is_retry ? new Date().toISOString() : undefined,
    }

    if (pendingReel && !anyFailed) {
      insights.instagram_reel_pending = {
        container_id: pendingReel.containerId,
        ig_user_id: pendingReel.igUserId,
        started_at: new Date().toISOString(),
      }
    } else {
      delete insights.instagram_reel_pending
    }

    // Set Facebook post URL and ID
    if (facebookResult?.postId) {
      postUrl = `https://www.facebook.com/${facebookResult.postId}`
      insights.facebook_post_id = facebookResult.postId
    }

    // Set Instagram media ID and permalink
    if (instagramResult?.postId) {
      insights.instagram_media_id = instagramResult.postId
      if (instagramResult.permalink) {
        insights.instagram_permalink = instagramResult.permalink
      }
    }

    // Update the post
    const [updatedPost] = await socials.updateSocialPosts([
      {
        selector: { id: input.post.id },
        data: {
          status: allSucceeded ? "posted" : pendingReel && !anyFailed ? "scheduled" : "failed",
          posted_at: allSucceeded ? new Date() : null,
          post_url: postUrl,
          insights,
          error_message: anyFailed
            ? input.merged_results
                .filter((r: any) => !r.success)
                .map((r: any) => `${r.platform}: ${r.error}`)
                .join("; ")
            : null,
        },
      },
    ])

    console.log(
      `[Update Post] ✓ Post updated with status: ${allSucceeded ? "posted" : pendingReel && !anyFailed ? "scheduled (Instagram Reel processing)" : "failed"}`
    )

    return new StepResponse({
      pending: Boolean(pendingReel && !anyFailed),
      updated_post: updatedPost,
      success: allSucceeded,
      results: {
        twitter: undefined,
        facebook: facebookResult,
        instagram: instagramResult,
      } as any,
      retry_info: input.is_retry ? {
        is_retry: true,
        previous_attempts: input.merged_results.length,
        retried_platform: input.merged_results.length === 1 ? input.merged_results[0].platform : null,
      } : undefined,
    })
  }
)
