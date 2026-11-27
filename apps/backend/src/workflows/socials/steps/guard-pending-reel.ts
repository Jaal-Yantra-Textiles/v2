import { MedusaError } from "@medusajs/utils"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Refuse to publish a post whose Instagram Reel is still processing.
 *
 * A pending Reel's last result reads `success: false`, so a retry would
 * otherwise create a SECOND container and post the Reel twice once both
 * finish. The publish-instagram-reel workflow settles the post (posted or
 * failed); publish again only after that.
 */
export const guardPendingReelStep = createStep(
  "guard-pending-reel",
  async (input: { post: any }) => {
    const reel = (input.post?.insights as any)?.instagram_reel
    if (reel?.transaction_id) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        reel.stage === "awaiting_confirmation"
          ? "This post's Instagram Reel is processed and waiting for confirmation. Confirm it (POST /admin/social-posts/:id/reel/confirm) or cancel it — do not publish again."
          : `This post's Instagram Reel is still processing (since ${reel.started_at}). Do not publish it again; it will wait for your confirmation once ready.`
      )
    }
    return new StepResponse({ ok: true })
  }
)
