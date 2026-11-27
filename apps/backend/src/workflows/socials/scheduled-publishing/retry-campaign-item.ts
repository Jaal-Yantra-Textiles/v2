import type { MedusaContainer } from "@medusajs/framework/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import type SocialsService from "../../../modules/socials/service"
import type { CampaignItem, ContentRule } from "../../../modules/socials/types/publishing-automation"
import { publishSocialPostUnifiedWorkflow } from "../publish-social-post-unified"
import { processCampaignItemWorkflow } from "./process-campaign-item-workflow"

export type CampaignItemRetryResult = {
  success: boolean
  social_post_id?: string
  post_url?: string | null
  error?: string | null
  /** true when the item's existing post was retried (or already posted) */
  reused_post: boolean
}

/**
 * Retry ONE failed campaign item (#2684).
 *
 * Campaign "New Products", 2026-11-27: the robe's first post went to
 * Instagram but not Facebook. "Retry" re-ran processCampaignItemWorkflow,
 * which always mints a NEW post — so the new post went to Instagram again
 * (a public duplicate) and the item was repointed at it, losing the original.
 *
 * Rule: if the item already has a post, retry THAT post. The unified publish
 * workflow's smart retry then resends only the platforms that failed. A post
 * that is already `posted` sends nothing; the item is just marked published.
 * Only an item with no post (or whose post is gone) builds a new one.
 */
export async function retryCampaignItem(
  scope: MedusaContainer,
  args: {
    campaign: { id: string; name: string; platform_id: string; content_rule: ContentRule }
    item: CampaignItem
    item_index: number
    platform_name: string
  }
): Promise<CampaignItemRetryResult> {
  const { campaign, item, item_index, platform_name } = args

  if (item.social_post_id) {
    const socials = scope.resolve(SOCIALS_MODULE) as SocialsService
    const [post] = (await socials.listSocialPosts({ id: item.social_post_id })) as any[]

    if (post) {
      if (post.status === "posted") {
        return { success: true, social_post_id: post.id, post_url: post.post_url ?? null, error: null, reused_post: true }
      }

      const { result } = await publishSocialPostUnifiedWorkflow(scope).run({
        input: { post_id: post.id },
      })
      const r = result as any
      return {
        success: Boolean(r?.success),
        social_post_id: post.id,
        post_url: r?.post?.post_url ?? null,
        error: r?.success ? null : "Publishing failed",
        reused_post: true,
      }
    }
  }

  const { result } = await processCampaignItemWorkflow(scope).run({
    input: {
      product_id: item.product_id,
      platform_id: campaign.platform_id,
      platform_name,
      campaign_name: campaign.name,
      campaign_id: campaign.id,
      item_index,
      content_rule: campaign.content_rule,
    },
  })
  return {
    success: result.success,
    social_post_id: result.social_post_id,
    post_url: result.post_url ?? null,
    error: result.error ?? null,
    reused_post: false,
  }
}
