import { MedusaError } from "@medusajs/utils"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Refuse to publish a post whose Instagram Reel is still processing.
 *
 * A pending Reel's last result reads `success: false`, so a retry would
 * otherwise create a SECOND container and post the Reel twice once both
 * finish. The finish-instagram-reels job settles the post (posted or
 * failed); publish again only after that.
 */
export const guardPendingReelStep = createStep(
  "guard-pending-reel",
  async (input: { post: any }) => {
    const pending = (input.post?.insights as any)?.instagram_reel_pending
    if (pending?.container_id) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `This post's Instagram Reel is still processing (container ${pending.container_id}, started ${pending.started_at}). It will publish on its own within a few minutes; do not publish it again.`
      )
    }
    return new StepResponse({ ok: true })
  }
)
