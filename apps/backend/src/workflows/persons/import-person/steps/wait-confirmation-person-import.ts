import { createStep } from "@medusajs/framework/workflows-sdk"

export const waitConfirmationPersonImportStepId =
  "wait-confirmation-person-import"
/**
 * This step waits until a person import is confirmed. It's useful before executing the
 * batch persons workflow.
 * 
 * This step is asynchronous and will make the workflow using it a Long-Running Workflow.
 */
export const waitConfirmationPersonImportStep = createStep(
  {
    name: waitConfirmationPersonImportStepId,
    async: true,
    // After an hour we want to timeout and cancel the import so we don't have orphaned workflows
    timeout: 60 * 60 * 1,
  },
  async () => {}
)
