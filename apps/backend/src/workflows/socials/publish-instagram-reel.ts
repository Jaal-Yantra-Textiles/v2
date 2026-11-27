import { MedusaError } from "@medusajs/framework/utils"
import { PermanentStepFailureError } from "@medusajs/framework/orchestration"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep } from "@medusajs/medusa/core-flows"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type InstagramService from "../../modules/social-provider/instagram-service"
import { reelProcessingVerdict } from "../../modules/social-provider/reel"
import type SocialProviderService from "../../modules/social-provider/service"
import type { ReelOptions } from "../../modules/social-provider/types"
import { SOCIALS_MODULE } from "../../modules/socials"
import type SocialsService from "../../modules/socials/service"
import { decryptAccessToken } from "../../modules/socials/utils/token-helpers"

/**
 * publish-instagram-reel — a LONG-RUNNING workflow that publishes one
 * Instagram Reel (video + caption), run by the workflow engine (Redis in
 * prod, so it survives restarts):
 *
 *   create container → wait until Instagram has processed the video
 *   (background retries, every 30 s, ~1 h) → wait for an admin to CONFIRM
 *   (POST /admin/social-posts/:id/reel/confirm, or /cancel) → publish →
 *   post `posted` with its permalink.
 *
 * Any failure (Instagram rejects the video, processing never finishes, the
 * confirmation times out or is cancelled, the publish call fails) alerts the
 * admin feed and marks the post `failed` (compensation of the first step).
 *
 * The access token is never in the workflow input — every step reads it from
 * the post's platform, so no secret is persisted in the execution state.
 */
export const publishInstagramReelWorkflowId = "publish-instagram-reel"
export const waitReelProcessedStepId = "wait-instagram-reel-processed"
export const awaitReelConfirmationStepId = "await-instagram-reel-confirmation"

/** 120 × 30 s ≈ 1 hour of Instagram processing before giving up. */
const PROCESSING_RETRIES = 120
const PROCESSING_RETRY_INTERVAL_S = 30
/** Instagram expires an unpublished container after 24 h — confirm before. */
const CONFIRMATION_TIMEOUT_S = 23 * 60 * 60

export type PublishInstagramReelInput = {
  post_id: string
  ig_user_id: string
  video_url: string
  caption: string
  reel?: ReelOptions
}

/** The post with its platform, and the token to call Instagram with. */
const loadPostAndToken = async (container: any, postId: string) => {
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const [post] = await socials.listSocialPosts({ id: postId }, { relations: ["platform"] })
  if (!post) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Social post ${postId} not found`)
  }
  const token = decryptAccessToken(((post as any).platform?.api_config || {}) as Record<string, any>, container)
  return { socials, post: post as any, token }
}

const instagram = (container: any) =>
  (container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService).getProvider("instagram") as InstagramService

/** Merge into the post's insights from a FRESH read (other steps write too). */
const patchPost = async (container: any, postId: string, patch: (insights: Record<string, any>) => Record<string, any>, data: Record<string, any> = {}) => {
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const [post] = await socials.listSocialPosts({ id: postId })
  if (!post) return
  const insights = patch({ ...(((post as any).insights || {}) as Record<string, any>) })
  await socials.updateSocialPosts([{ selector: { id: postId }, data: { ...data, insights } as any }])
}

// 1. Create the Reels container. Its compensation runs if ANY later step fails:
//    the post becomes `failed` and the pending marker is cleared.
const createReelContainerStep = createStep(
  "create-instagram-reel-container",
  async (input: PublishInstagramReelInput, { container }) => {
    const { token } = await loadPostAndToken(container, input.post_id)
    const reel = input.reel || {}
    const created = await instagram(container).startReel(
      input.ig_user_id,
      {
        video_url: input.video_url,
        caption: input.caption,
        share_to_feed: reel.share_to_feed,
        cover_url: reel.cover_url,
        thumb_offset: reel.thumb_offset,
      },
      token
    )
    return new StepResponse({ container_id: created.id }, { post_id: input.post_id })
  },
  async (compensate, { container }) => {
    if (!compensate) return
    await patchPost(
      container,
      compensate.post_id,
      (insights) => {
        insights.instagram_reel = null // null, not delete: insights MERGES on update
        const results = Array.isArray(insights.publish_results) ? [...insights.publish_results] : []
        const i = results.findIndex((r: any) => r?.platform === "instagram")
        const failed = {
          platform: "instagram",
          success: false,
          error: "The Instagram Reel did not publish (processing failed or timed out, or it was cancelled). See the admin notification.",
        }
        if (i >= 0) results[i] = failed
        else results.push(failed)
        return { ...insights, publish_results: results }
      },
      {
        status: "failed",
        error_message: "instagram: the Reel did not publish (processing failed or timed out, or it was cancelled)",
      }
    )
  }
)

// 2. Wait for Instagram to finish processing — retried in the background.
//    Still processing → a plain throw (the engine retries in 30 s);
//    ERROR/EXPIRED → PermanentStepFailureError (no more retries: alert + compensate).
const waitReelProcessedStep = createStep(
  {
    name: waitReelProcessedStepId,
    maxRetries: PROCESSING_RETRIES,
    retryInterval: PROCESSING_RETRY_INTERVAL_S,
  },
  async (input: { post_id: string; container_id: string }, { container }) => {
    const { token } = await loadPostAndToken(container, input.post_id)
    const status = await instagram(container).checkContainerStatus(input.container_id, token)
    const verdict = reelProcessingVerdict(status.status_code)
    if (verdict === "fail") {
      throw new PermanentStepFailureError(
        `Instagram could not process the Reel video (${status.status_code}${status.status ? `: ${status.status}` : ""})`
      )
    }
    if (verdict === "retry") {
      throw new Error(`Instagram is still processing the Reel (${status.status_code})`)
    }
    return new StepResponse({ ready: true })
  }
)

// 3. Mark the post as waiting for an admin's confirmation.
const markAwaitingConfirmationStep = createStep(
  "mark-instagram-reel-awaiting-confirmation",
  async (input: { post_id: string }, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const [post] = await socials.listSocialPosts({ id: input.post_id })
    const marker = ((post as any)?.insights || {}).instagram_reel
    if (!marker?.transaction_id) {
      // Cancelled (or cleared) while Instagram was still processing: stop
      // here — nothing is published, and the post is already settled.
      throw new PermanentStepFailureError("The Instagram Reel was cancelled while processing")
    }
    await patchPost(container, input.post_id, (insights) => ({
      ...insights,
      instagram_reel: {
        ...(insights.instagram_reel || {}),
        stage: "awaiting_confirmation",
        awaiting_since: new Date().toISOString(),
      },
    }))
    return new StepResponse({ ok: true })
  }
)

// 4. Wait for the admin: completed by POST /admin/social-posts/:id/reel/confirm
//    (setStepSuccess) or failed by /reel/cancel (setStepFailure).
const awaitReelConfirmationStep = createStep(
  { name: awaitReelConfirmationStepId, async: true, timeout: CONFIRMATION_TIMEOUT_S },
  async () => {
    // Intentionally empty: the confirm/cancel routes complete this step.
  }
)

// 5. Publish the processed container and settle the post.
const publishReelStep = createStep(
  "publish-instagram-reel",
  async (input: { post_id: string; ig_user_id: string; container_id: string }, { container }) => {
    const { token } = await loadPostAndToken(container, input.post_id)
    const ig = instagram(container)
    const published = await ig.publishReadyContainer(input.ig_user_id, input.container_id, token)
    let permalink: string | undefined
    try {
      permalink = await ig.getMediaPermalink(published.id, token)
    } catch {
      // best effort
    }

    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const [post] = await socials.listSocialPosts({ id: input.post_id })
    const insights: Record<string, any> = { ...(((post as any)?.insights || {}) as Record<string, any>) }
    insights.instagram_reel = null // null, not delete: insights MERGES on update
    const results = Array.isArray(insights.publish_results) ? [...insights.publish_results] : []
    const ok = { platform: "instagram", success: true, postId: published.id, permalink }
    const i = results.findIndex((r: any) => r?.platform === "instagram")
    if (i >= 0) results[i] = ok
    else results.push(ok)
    insights.publish_results = results
    insights.instagram_media_id = published.id
    if (permalink) insights.instagram_permalink = permalink
    const allOk = results.every((r: any) => r?.success)

    await socials.updateSocialPosts([
      {
        selector: { id: input.post_id },
        data: {
          status: allOk ? "posted" : "failed",
          posted_at: allOk ? new Date() : null,
          post_url: (post as any)?.post_url || permalink || null,
          insights,
          error_message: allOk
            ? null
            : results
                .filter((r: any) => !r?.success)
                .map((r: any) => `${r.platform}: ${r.error}`)
                .join("; "),
        } as any,
      },
    ])
    return new StepResponse({ media_id: published.id, permalink })
  }
)

export const publishInstagramReelWorkflow = createWorkflow(
  publishInstagramReelWorkflowId,
  (input: PublishInstagramReelInput) => {
    const failureNotification = transform({ input }, ({ input }) => [
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "Instagram Reel failed",
          description: `The Instagram Reel for post ${input.post_id} did not publish. Open the post for the reason, then publish again.`,
        },
      },
    ])
    notifyOnFailureStep(failureNotification)

    const created = createReelContainerStep(input)

    waitReelProcessedStep({ post_id: input.post_id, container_id: created.container_id }).config({
      backgroundExecution: true,
    })

    markAwaitingConfirmationStep({ post_id: input.post_id })
    awaitReelConfirmationStep()

    const published = publishReelStep({
      post_id: input.post_id,
      ig_user_id: input.ig_user_id,
      container_id: created.container_id,
    })

    return new WorkflowResponse(published)
  }
)
