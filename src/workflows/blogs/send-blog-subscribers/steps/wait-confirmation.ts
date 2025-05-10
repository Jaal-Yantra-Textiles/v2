import { createStep } from "@medusajs/framework/workflows-sdk"

export const waitConfirmationBlogSendStepId = "wait-confirmation-blog-send"

/**
 * This step waits for confirmation before proceeding with sending the blog to subscribers.
 * It makes the workflow a long-running workflow and prevents orphaned workflows.
 * 
 * This step is asynchronous and will make the workflow using it a Long-Running Workflow.
 * 
 * @example
 * const confirmed = waitConfirmationBlogSendStep()
 */
export const waitConfirmationBlogSendStep = createStep(
  {
    name: waitConfirmationBlogSendStepId,
    async: true,
    // After an hour we want to timeout and cancel the subscription so we don't have orphaned workflows
    timeout: 60 * 60 * 1,
  },
  async () => {
    console.log("Waiting for confirmation to send blog to subscribers")
    // The empty function body is intentional
    // This step will be completed by the confirmation API endpoint
  }
)
