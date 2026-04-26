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
import { getUngeocodedAddressesStep } from "./steps/get-ungeocoded-addresses"
import { waitConfirmationGeocodeAddressesStep } from "./steps/wait-confirmation-geocode-addresses"
import { batchGeocodeAddressesWorkflow } from "./batch-geocode-addresses"
import { verifyGeocodedAddressesStep } from "./steps/verify-geocoded-addresses"

export const geocodeAllAddressesWorkflowId = "geocode-all-addresses"

export const geocodeAllAddressesWorkflow = createWorkflow(
  {
    name: geocodeAllAddressesWorkflowId,
    store: true,
  },
  
  (input: WorkflowData<{ person_id: string }>) => {
    const addressesToGeocode = getUngeocodedAddressesStep(input)

    const summary = transform({ addressesToGeocode }, (data) => {
      return {
        count: data.addressesToGeocode.length,
        message: `${data.addressesToGeocode.length} addresses require geocoding.`,
      }
    })

    waitConfirmationGeocodeAddressesStep()

    const failureNotification = transform({ summary }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Address Geocoding",
            description: `Failed to geocode ${data.summary.count} addresses.`,
          },
        },
      ]
    })

    notifyOnFailureStep(failureNotification)

    const batchInput = transform({ addressesToGeocode }, (data) => {
      return { addresses: data.addressesToGeocode }
    })

    batchGeocodeAddressesWorkflow.runAsStep({ input: batchInput })

    verifyGeocodedAddressesStep({ addresses: addressesToGeocode })

    const successNotification = transform({ summary }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Address Geocoding Complete",
            description: `Successfully geocoded and verified ${data.summary.count} addresses.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)

    return new WorkflowResponse(summary)
  }
)
