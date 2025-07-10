import { FetchError } from "@medusajs/js-sdk";
import { UseMutationOptions, useMutation } from "@tanstack/react-query";
import { sdk } from "../../lib/config";

interface ConfirmGeocodeAllAddressesPayload {
  transactionId: string;
  workflowId: string;
  stepId: string;
}

interface GeoCodeResponse {
  success: boolean;
}

// Hook for geocoding all addresses for a person
export const useGeocodeAllAddresses = (
  personId: string,
  options?: UseMutationOptions<{ summary: any; transaction_id: string }, FetchError>
) => {
  return useMutation({
    mutationFn: async () => {
      const response = (await sdk.client.fetch(
        `/admin/persons/${personId}/geocode-addresses`,
        {
          method: "POST",
        }
      )) as { data: any };
      return response.data as { summary: any; transaction_id: string };
    },
    ...options,
  });
}

// Hook for confirming a geocode all addresses operation
export const useConfirmGeocodeAllAddresses = (
  options?: UseMutationOptions<GeoCodeResponse, FetchError, ConfirmGeocodeAllAddressesPayload>
) => {
  return useMutation({
    mutationFn: async (data: ConfirmGeocodeAllAddressesPayload) => {
      const response = (await sdk.client.fetch(
        `/admin/persons/geocode-addresses/${data.transactionId}/confirm`,
        {
          method: "POST",
          body: { workflow_id: data.workflowId, step_id: data.stepId },
        }
      )) as { data: any };
      return response.data as GeoCodeResponse;
    },
    ...options,
  });
};

// Hook for backfilling all geocodes
export const useBackfillAllGeocodes = (
  options?: UseMutationOptions<{ summary: any; transaction_id: string }, FetchError>
) => {
  return useMutation({
    mutationFn: async () => {
      return sdk.client.fetch(
        `/admin/persons/geocode-addresses`,
        {
          method: "POST",
        }
      ) as Promise<{ summary: any; transaction_id: string }>
    },
    ...options,
  });
}

