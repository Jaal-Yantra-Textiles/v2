import { MedusaContainer } from "@medusajs/framework/types"
import { SOCIAL_PROVIDER_MODULE } from "../modules/social-provider"
import {
  checkPendingReel,
  PENDING_REEL_MAX_AGE_MS,
  type PendingReel,
} from "../modules/social-provider/finish-pending-reel"
import type SocialProviderService from "../modules/social-provider/service"
import type InstagramService from "../modules/social-provider/instagram-service"
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"
import { decryptAccessToken } from "../modules/socials/utils/token-helpers"

/**
 * Finishes Instagram Reels that were still processing when their publish
 * request handed off (a Reel can take minutes; the request waits ~60 s).
 *
 * Picks posts left `scheduled` with `insights.instagram_reel_pending`, checks
 * each container once, and:
 * - FINISHED → media_publish → post `posted` with the media id + permalink;
 * - ERROR / EXPIRED, or still processing after an hour → post `failed`;
 * - otherwise leaves it for the next minute.
 */
export default async function finishInstagramReels(container: MedusaContainer) {
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const provider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const ig = provider.getProvider("instagram") as InstagramService

  const posts = await socials.listSocialPosts(
    { status: "scheduled" } as any,
    { relations: ["platform"], take: 200 }
  )
  const pending = posts.filter((p: any) => (p.insights as any)?.instagram_reel_pending?.container_id)
  if (!pending.length) return

  for (const post of pending as any[]) {
    const marker = post.insights.instagram_reel_pending as PendingReel
    try {
      const token = decryptAccessToken((post.platform?.api_config || {}) as Record<string, any>, container)
      const outcome = await checkPendingReel(marker, token, ig)
      if (outcome.kind === "still-processing") continue

      const insights: Record<string, any> = { ...(post.insights || {}) }
      delete insights.instagram_reel_pending
      // Replace the pending Instagram entry in the stored publish results.
      const results = Array.isArray(insights.publish_results) ? [...insights.publish_results] : []
      const igIndex = results.findIndex((r: any) => r?.platform === "instagram")
      const igResult =
        outcome.kind === "posted"
          ? { platform: "instagram", success: true, postId: outcome.media_id, permalink: outcome.permalink }
          : { platform: "instagram", success: false, error: outcome.error.replace(/^instagram: /, "") }
      if (igIndex >= 0) results[igIndex] = igResult
      else results.push(igResult)
      insights.publish_results = results

      if (outcome.kind === "posted") {
        insights.instagram_media_id = outcome.media_id
        if (outcome.permalink) insights.instagram_permalink = outcome.permalink
      }
      const allOk = results.every((r: any) => r?.success)

      await socials.updateSocialPosts([
        {
          selector: { id: post.id },
          data: {
            status: allOk ? "posted" : "failed",
            posted_at: allOk ? new Date() : null,
            post_url: post.post_url || (outcome.kind === "posted" ? outcome.permalink ?? null : null),
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
      console.log(`[finish-instagram-reels] ${post.id}: ${outcome.kind}`)
    } catch (e: any) {
      // A transient Graph/network failure: leave the marker, try next minute —
      // but not forever. Past the hour limit (e.g. a token that no longer
      // works) the post fails with the reason, so it never sits "scheduled".
      const age = Date.now() - new Date(marker.started_at).getTime()
      if (Number.isFinite(age) && age > PENDING_REEL_MAX_AGE_MS) {
        const insights: Record<string, any> = { ...(post.insights || {}) }
        delete insights.instagram_reel_pending
        await socials
          .updateSocialPosts([
            {
              selector: { id: post.id },
              data: {
                status: "failed",
                insights,
                error_message: `instagram: could not finish the Reel — ${e?.message || "unknown error"}`,
              } as any,
            },
          ])
          .catch(() => undefined)
      }
      console.warn(`[finish-instagram-reels] ${post.id}: check failed — ${e?.message}`)
    }
  }
}

export const config = {
  name: "finish-instagram-reels",
  schedule: "* * * * *", // every minute
}
