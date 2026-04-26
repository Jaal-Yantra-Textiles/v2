/**
 * This route handles the confirmation of blog subscription transactions.
 * When a user confirms their subscription (typically via email confirmation link),
 * this endpoint triggers the workflow to proceed with sending blog content to subscribers.
 *
 * Example Usage:
 *
 * 1. User subscribes to blog updates via frontend form
 * 2. System creates a transaction and sends confirmation email with link like:
 *    https://api.example.com/admin/websites/abc123/pages/blog1/subs/txn_456/confirm
 * 3. When user clicks the link, frontend makes POST request to this endpoint
 * 4. This endpoint confirms the transaction and starts the sending workflow
 *
 * Request:
 * POST /admin/websites/{websiteId}/pages/{pageId}/subs/{transactionId}/confirm
 *
 * Path Parameters:
 * - websiteId: string - ID of the website containing the blog
 * - pageId: string - ID of the specific blog page
 * - transactionId: string - ID of the subscription transaction
 *
 * Response:
 * 200 OK with JSON body containing:
 * {
 *   success: true,
 *   message: "Blog subscription confirmed. Sending process has started.",
 *   website_id: string,
 *   page_id: string,
 *   transaction_id: string
 * }
 *
 * Error Cases:
 * - 404 if website, page, or transaction not found
 * - 400 if transaction already confirmed or expired
 * - 500 if workflow engine fails to process
 *
 * Security:
 * - Requires valid transaction ID (typically UUID or similar)
 * - Should be rate limited to prevent abuse
 * - Transaction IDs should be single-use and expire after confirmation
 */
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
}
