import {
  WorkflowResponse,
  createWorkflow,
  transform,
  WorkflowData,
} from "@medusajs/framework/workflows-sdk"
import {
  notifyOnFailureStep,
  sendNotificationsStep,
} from "@medusajs/medusa/core-flows"
import { getAllUngeocodedAddressesStep } from "./steps/get-all-ungeocoded-addresses"
import { waitConfirmationBackfillGeocodesStep } from "./steps/wait-confirmation-backfill-geocodes"
import { batchGeocodeAddressesWorkflow } from "./batch-geocode-addresses"

export const backfillAllGeocodesWorkflowId = "backfill-all-geocodes"

export const backfillAllGeocodesWorkflow = createWorkflow(
  {
    name: backfillAllGeocodesWorkflowId,
    store: true,
  },
  (input: WorkflowData<{}>) => {
    const addressesToGeocode = getAllUngeocodedAddressesStep()

    const summary = transform({ addressesToGeocode }, (data) => {
      return {
        count: data.addressesToGeocode.length,
        message: `${data.addressesToGeocode.length} addresses require geocoding. Confirm to start the backfill.`,
      }
    })

    waitConfirmationBackfillGeocodesStep()

    const failureNotification = transform({ summary }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Geocode Backfill Failed",
            description: `Failed to start geocode backfill for ${data.summary.count} addresses.`,
          },
        },
      ]
    })

    notifyOnFailureStep(failureNotification)

    const batchInput = transform({ addressesToGeocode }, (data) => {
      return { addresses: data.addressesToGeocode }
    })

    batchGeocodeAddressesWorkflow
      .runAsStep({ input: batchInput })
      .config({ async: true, backgroundExecution: true })

    const successNotification = transform({ summary }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Geocode Backfill Started",
            description: `Successfully processed ${data.summary.count} addresses for geocoding.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)

    return new WorkflowResponse(summary)
  }
)
