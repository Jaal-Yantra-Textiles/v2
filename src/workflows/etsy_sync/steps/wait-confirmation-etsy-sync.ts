import { createStep } from "@medusajs/framework/workflows-sdk"

export const waitConfirmationEtsySyncStepId =
  "wait-confirmation-etsy-sync"

/**
 * This step waits until an Etsy sync is confirmed before executing
 * the actual background sync workflow.
 *
 * This step is asynchronous and will make the workflow using it
 * a Long-Running Workflow.
 */
export const waitConfirmationEtsySyncStep = createStep(
  {
    name: waitConfirmationEtsySyncStepId,
    async: true,
    // Timeout after 1 hour to avoid orphaned workflows
    timeout: 60 * 60 * 1,
  },
  async () => {}
)
