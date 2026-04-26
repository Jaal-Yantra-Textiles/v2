import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { publishSocialPostWorkflow } from "../publish-post"
import { publishToBothPlatformsUnifiedWorkflow } from "../publish-to-both-platforms"

/**
 * Step 9: Route to Platform Workflow
 * 
 * Routes to the appropriate platform-specific workflow:
 * - Twitter/X → publishSocialPostWorkflow
 * - Facebook/Instagram → publishToBothPlatformsUnifiedWorkflow
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
