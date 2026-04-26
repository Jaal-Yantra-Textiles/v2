import { createStep } from "@medusajs/framework/workflows-sdk"

export const waitConfirmationBackfillGeocodesStepId =
  "wait-confirmation-backfill-geocodes"
/**
 * This step waits until a bulk geocode backfill is confirmed. It's useful before executing the
 * batch geocoding workflow for all ungeocoded addresses.
 * 
 * This step is asynchronous and will make the workflow using it a Long-Running Workflow.
 */
export const waitConfirmationBackfillGeocodesStep = createStep(
  {
    name: waitConfirmationBackfillGeocodesStepId,
    async: true,
    // After an hour we want to timeout and cancel the geocoding so we don't have orphaned workflows
    timeout: 60 * 60 * 1,
  },
  async () => {
    console.log("Waiting for confirmation to backfill all geocodes")
  }
)
