import { createStep } from "@medusajs/framework/workflows-sdk"

export const waitConfirmationGeocodeAddressesStepId =
  "wait-confirmation-geocode-addresses"
/**
 * This step waits until a geocode backfill is confirmed. It's useful before executing the
 * batch geocoding workflow.
 * 
 * This step is asynchronous and will make the workflow using it a Long-Running Workflow.
 */
export const waitConfirmationGeocodeAddressesStep = createStep(
  {
    name: waitConfirmationGeocodeAddressesStepId,
    async: true,
    // After an hour we want to timeout and cancel the geocoding so we don't have orphaned workflows
    timeout: 60 * 60 * 1,
  },
  async () => {
    console.log("Waiting for confirmation to geocode addresses")
  }
)
