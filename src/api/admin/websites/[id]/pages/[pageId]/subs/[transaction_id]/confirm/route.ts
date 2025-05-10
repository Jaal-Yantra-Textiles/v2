import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { waitConfirmationBlogSendStepId } from "../../../../../../../../../workflows/blogs/send-blog-subscribers/steps/wait-confirmation"
import { sendBlogSubscribersWorkflowId } from "../../../../../../../../../workflows/blogs/send-blog-subscribers/workflows/send-blog-subscribers"

/**
 * @swagger
 * /admin/websites/{id}/pages/{pageId}/subs/{transaction_id}/confirm:
 *   post:
 *     summary: Confirm blog subscription
 *     description: Confirms a blog subscription transaction, starting the actual sending process.
 *     tags:
 *       - Blog
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the website
 *       - in: path
 *         name: pageId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the blog page
 *       - in: path
 *         name: transaction_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the transaction to confirm
 *     responses:
 *       200:
 *         description: OK
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  )
  const { id: websiteId, pageId, transaction_id: transactionId } = req.params

  try {
    // Confirm the workflow by setting the wait confirmation step as successful
    await workflowEngineService.setStepSuccess({
      idempotencyKey: {
        action: TransactionHandlerType.INVOKE,
        transactionId,
        stepId: waitConfirmationBlogSendStepId,
        workflowId: sendBlogSubscribersWorkflowId,
      },
      stepResponse: new StepResponse(true),
    })

    // Return success response
    return res.status(200).json({ 
      success: true,
      message: "Blog subscription confirmed. Sending process has started.",
      website_id: websiteId,
      page_id: pageId,
      transaction_id: transactionId
    })
  } catch (error) {
    console.error("Error confirming blog subscription:", error)
    
    return res.status(500).json({
      success: false,
      message: "Failed to confirm blog subscription",
      error: error.message || "An unexpected error occurred"
    })
  }
}
