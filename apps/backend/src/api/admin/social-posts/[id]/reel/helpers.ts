import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import type SocialsService from "../../../../../modules/socials/service"
import type { InstagramReelMarker } from "../../../../../modules/social-provider/reel"

/** The post and its Instagram Reel marker, or a clear 404/409. */
export async function loadReelPost(container: MedusaContainer, postId: string) {
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const [post] = await socials.listSocialPosts({ id: postId })
  if (!post) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Social post ${postId} not found`)
  }
  const reel = ((post as any).insights || {}).instagram_reel as InstagramReelMarker | undefined
  if (!reel?.transaction_id) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "This post has no Instagram Reel in progress."
    )
  }
  return { socials, post: post as any, reel }
}
