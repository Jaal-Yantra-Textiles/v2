import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { geocodeAddressWorkflow } from "./geocode-address"

type BatchGeocodeAddressesWorkflowInput = {
  addresses: { id: string }[]
}


interface GeocodeResult {
  success: boolean;
  address_id: string;
  error?: any;
}

const batchGeocodeStep = createStep(
  "batch-geocode-step",
  async (input: BatchGeocodeAddressesWorkflowInput, { container }) => {
    if (!input.addresses || input.addresses.length === 0) {
      return new StepResponse({
        succeeded: [],
        failed: [],
        summary: "No addresses to process.",
      });
    }

    const results: GeocodeResult[] = [];
    for (const address of input.addresses) {
      try {
        await geocodeAddressWorkflow(container).run({
          input: {
            person_address_id: address.id,
          },
        });
        results.push({ success: true, address_id: address.id });
      } catch (error) {
        console.error(`Failed to geocode address ${address.id}:`, error);
        results.push({ success: false, address_id: address.id, error: error.message });
      }
      // Wait for 1 second before the next request to comply with Nominatim's usage policy
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const succeeded = results.filter((r) => r.success).map((r) => r.address_id);
    const failed = results.filter((r) => !r.success);

    const summaryMessage = `Geocoding complete. Succeeded: ${succeeded.length}, Failed: ${failed.length}.`;

    return new StepResponse({
      succeeded,
      failed,
      summary: summaryMessage,
    });
  }
);

export const batchGeocodeAddressesWorkflow = createWorkflow(
  "batch-geocode-addresses",
  function (input: BatchGeocodeAddressesWorkflowInput) {
    const result = batchGeocodeStep(input)
    return new WorkflowResponse(result)
  }
)
