/**
 * @route POST /admin/social-posts/:id/reel/cancel
 * @group SocialPosts
 * @param {string} id.path.required - The social post whose Instagram Reel should be abandoned
 * @returns {Object} 200 - { success: true, cleared_stale?: boolean }
 * @throws 404 - Post not found
 * @throws 409 - No Reel in progress
 *
 * While the Reel waits for confirmation: fails the confirmation step, so the
 * workflow alerts and marks the post `failed` (nothing was published).
 *
 * Escape hatch: if the workflow is no longer waiting (it already ended, or it
 * is still processing), the post's stale marker is cleared and the post set to
 * `failed`, so it can be published again. Nothing is ever posted by a cancel.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import {
  awaitReelConfirmationStepId,
  publishInstagramReelWorkflowId,
} from "../../../../../../workflows/socials/publish-instagram-reel"
import { loadReelPost } from "../helpers"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { socials, post, reel } = await loadReelPost(req.scope, req.params.id)

  if (reel.stage === "awaiting_confirmation") {
    const engine: IWorkflowEngineService = req.scope.resolve(Modules.WORKFLOW_ENGINE)
    try {
      await engine.setStepFailure({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: reel.transaction_id,
          stepId: awaitReelConfirmationStepId,
          workflowId: publishInstagramReelWorkflowId,
        },
        stepResponse: new Error("Cancelled by an admin before going live"),
      })
      return res.status(200).json({ success: true })
    } catch {
      // Not waiting any more — fall through and clear the marker.
    }
  }

  const insights = { ...(post.insights || {}) }
  insights.instagram_reel = null // null, not delete: insights MERGES on update
  await socials.updateSocialPosts([
    {
      selector: { id: post.id },
      data: {
        status: "failed",
        insights,
        error_message: "instagram: the Reel was cancelled before it went live",
      } as any,
    },
  ])
  res.status(200).json({ success: true, cleared_stale: true })
}
