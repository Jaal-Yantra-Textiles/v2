import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { publishSocialPostWorkflow } from "../publish-post"
import { publishToBothPlatformsUnifiedWorkflow } from "../publish-to-both-platforms"
import type { ReelOptions } from "../../../modules/social-provider/types"

/**
 * Step 9: Route to Platform Workflow
 * 
 * Routes to the appropriate platform-specific workflow:
 * - Twitter/X → publishSocialPostWorkflow
 * - Facebook/Instagram → publishToBothPlatformsUnifiedWorkflow
 * - an Instagram REEL → queued for the long-running publish-instagram-reel
 *   workflow, which startInstagramReelStep runs once the post is marked;
 *   with FB+IG "both", the Facebook video still goes through the direct path.
 * 
 * Returns publish results and optionally the updated post (Twitter returns it).
 */
export const routeToPlatformWorkflowStep = createStep(
  "route-to-platform-workflow",
  async (
    input: {
      platform_name: string
      post_id: string
      page_id?: string
      ig_user_id?: string
      user_access_token: string
      publish_target: string
      content_type: string
      caption: string
      image_url?: string
      image_urls?: string[]
      video_url?: string
      reel?: ReelOptions
    },
    { container }
  ) => {
    console.log(`[Route to Platform Workflow] Publishing to ${input.platform_name}...`)

    // Twitter workflow
    if (input.platform_name === "twitter" || input.platform_name === "x") {
      const { result } = await publishSocialPostWorkflow(container).run({
        input: { post_id: input.post_id },
      })

      console.log(`[Route to Platform Workflow] ✓ Twitter publish complete`)

      return new StepResponse({
        results: [{ ...result, platform: "twitter" }] as any[],
        updated_post: result as any, // Twitter workflow returns updated post
      })
    }

    // An Instagram-only platform arrives with publish_target "single" (the
    // retry step only sets instagram/facebook/both for FB+IG platforms).
    const platform = (input.platform_name || "").toLowerCase()
    const isReelToInstagram =
      input.content_type === "reel" &&
      (platform === "instagram" ||
        input.publish_target === "instagram" ||
        input.publish_target === "both")

    if (isReelToInstagram) {
      const results: any[] = []

      // Facebook half of an FB+IG Reel: the existing direct video post.
      if (input.publish_target === "both") {
        const { result: fb } = await publishToBothPlatformsUnifiedWorkflow(container).run({
          input: {
            pageId: input.page_id || "",
            igUserId: input.ig_user_id || "",
            userAccessToken: input.user_access_token,
            publishTarget: "facebook",
            content: {
              type: input.content_type as any,
              message: input.caption,
              caption: input.caption,
              video_url: input.video_url,
            },
          },
        })
        results.push(...((fb.results || []) as any[]))
      }

      // Instagram half: NOT started here. The post must be marked first
      // (status, marker with this transaction id) or the background steps
      // can race ahead of it — so this only reserves the id and carries the
      // Reel's input; startInstagramReelStep runs it after the post update.
      results.push({
        platform: "instagram",
        success: false,
        pending: true,
        transactionId: `ig-reel-${input.post_id}-${Date.now()}`,
        reelStart: {
          post_id: input.post_id,
          ig_user_id: input.ig_user_id || "",
          video_url: input.video_url || "",
          caption: input.caption,
          reel: input.reel,
        },
      })

      console.log(`[Route to Platform Workflow] ✓ Instagram Reel queued (starts after the post update)`)
      return new StepResponse({ results, updated_post: null as any })
    }

    // Facebook/Instagram workflow
    const { result } = await publishToBothPlatformsUnifiedWorkflow(container).run({
      input: {
        pageId: input.page_id || "",
        igUserId: input.ig_user_id || "",
        userAccessToken: input.user_access_token,
        publishTarget: input.publish_target as "facebook" | "instagram" | "both",
        content: {
          type: input.content_type as any,
          message: input.caption,
          caption: input.caption,
          image_url: input.image_url,
          image_urls: input.image_urls,
          video_url: input.video_url,
          reel: input.reel,
        },
      },
    })

    console.log(`[Route to Platform Workflow] ✓ Facebook/Instagram publish complete`)

    return new StepResponse({
      results: (result.results || []) as any[],
      updated_post: null as any, // FB/IG workflow doesn't update post
    })
  }
)
