import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { SOCIALS_MODULE } from "../../../modules/socials"
import type SocialsService from "../../../modules/socials/service"
import { publishInstagramReelWorkflow } from "../publish-instagram-reel"

/**
 * Step 12: start the long-running publish-instagram-reel workflow for a Reel
 * queued by route-to-platform-workflow — AFTER update-post-with-results has
 * marked the post (status `scheduled`, insights.instagram_reel with this
 * transaction id). Starting it earlier let the background steps run before
 * the marker existed when Instagram finished processing instantly.
 *
 * The workflow runs under the transaction id reserved in the route step, so
 * the confirm/cancel routes can find it from the post alone. If it cannot
 * even start (Instagram refuses the container), the post is failed here.
 */
export const startInstagramReelStep = createStep(
  "start-instagram-reel",
  async (input: { results: any[]; post_id: string }, { container }) => {
    const queued = (input.results || []).find(
      (r: any) => r?.platform === "instagram" && r?.pending && r?.reelStart && r?.transactionId
    )
    if (!queued) return new StepResponse({ started: false })

    const { errors } = await publishInstagramReelWorkflow(container).run({
      input: queued.reelStart,
      // The id reserved in the route step and already on the post's marker,
      // so the confirm/cancel routes can address this exact execution.
      context: { transactionId: queued.transactionId },
      throwOnError: false,
    })

    if (errors?.length) {
      const message = (errors[0] as any)?.error?.message || "Could not start the Instagram Reel"
      const socials = container.resolve(SOCIALS_MODULE) as SocialsService
      const [post] = await socials.listSocialPosts({ id: input.post_id })
      const insights: Record<string, any> = { ...(((post as any)?.insights || {}) as Record<string, any>) }
      // null, not delete: this json field MERGES on update, so a deleted key survives.
      insights.instagram_reel = null
      const results = Array.isArray(insights.publish_results) ? [...insights.publish_results] : []
      const i = results.findIndex((r: any) => r?.platform === "instagram")
      const failed = { platform: "instagram", success: false, error: message }
      if (i >= 0) results[i] = failed
      else results.push(failed)
      insights.publish_results = results
      await socials.updateSocialPosts([
        {
          selector: { id: input.post_id },
          data: { status: "failed", insights, error_message: `instagram: ${message}` } as any,
        },
      ])
      return new StepResponse({ started: false, error: message })
    }

    console.log(`[Start Instagram Reel] ✓ Workflow ${queued.transactionId} running in the background`)
    return new StepResponse({ started: true, transaction_id: queued.transactionId })
  }
)
