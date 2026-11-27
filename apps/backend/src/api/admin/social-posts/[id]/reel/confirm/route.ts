/**
 * @route POST /admin/social-posts/:id/reel/confirm
 * @group SocialPosts
 * @param {string} id.path.required - The social post whose processed Instagram Reel should go live
 * @returns {Object} 200 - { success: true, transaction_id }
 * @throws 404 - Post not found
 * @throws 409 - No Reel in progress, or it is still processing
 *
 * Completes the `await-instagram-reel-confirmation` step of the long-running
 * publish-instagram-reel workflow, which then publishes the Reel and marks
 * the post `posted`. Publishing happens in the background right after this.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { MedusaError, Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  awaitReelConfirmationStepId,
  publishInstagramReelWorkflowId,
} from "../../../../../../workflows/socials/publish-instagram-reel"
import { loadReelPost } from "../helpers"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { reel } = await loadReelPost(req.scope, req.params.id)
  if (reel.stage !== "awaiting_confirmation") {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Instagram is still processing this Reel. You can confirm it once it shows as ready."
    )
  }

  const engine: IWorkflowEngineService = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  await engine.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId: reel.transaction_id,
      stepId: awaitReelConfirmationStepId,
      workflowId: publishInstagramReelWorkflowId,
    },
    stepResponse: new StepResponse({ confirmed: true }),
  })

  res.status(200).json({ success: true, transaction_id: reel.transaction_id })
}
