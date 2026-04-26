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
      const response = await sdk.client.fetch(
        `/admin/persons/${personId}/geocode-addresses`,
        {
          method: "POST",
        }
      );

      /**
       * sdk.client.fetch can return either the raw JSON body or a wrapped `{ data }` object
       * depending on the underlying client implementation. Normalize the shape here so the
       * component can safely destructure `summary` and `transaction_id`.
       */
      if ("data" in (response as any)) {
        return (response as { data: { summary: any; transaction_id: string } }).data;
      }

      return response as { summary: any; transaction_id: string };
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
      const response = await sdk.client.fetch(
        `/admin/persons/geocode-addresses`,
        {
          method: "POST",
        }
      );

      if ("data" in (response as any)) {
        return (response as { data: { summary: any; transaction_id: string } }).data;
      }

      return response as { summary: any; transaction_id: string };
    },
    ...options,
  });
}

