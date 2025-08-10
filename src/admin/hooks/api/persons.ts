import { FetchError } from "@medusajs/js-sdk";
import { HttpTypes, PaginatedResponse } from "@medusajs/types";
import {
  keepPreviousData,
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";
import {
  AddressDetails,
  AddressInput,
  AdminCreatePerson,
  AdminPerson,
  AdminPersonDeleteResponse,
  AdminPersonResponse,
  AdminUpdatePerson,
} from "./personandtype";

export interface PersonDetails {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  notes: string | null;
  person_types: any[];
  contacts?: any[];
  addresses?: any[];
}

const PERSONS_QUERY_KEY = "persons" as const;
export const personsQueryKeys = queryKeysFactory(PERSONS_QUERY_KEY);

export const usePerson = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { person: AdminPerson },
      FetchError,
      { person: AdminPerson },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    // Include `query` in the key to avoid cache collisions across different field expansions
    queryKey: personsQueryKeys.detail(id, query),
    queryFn: async () =>
      sdk.client.fetch<{ person: AdminPerson }>(`/admin/persons/${id}`, {
        method: "GET",
        query,
      }),
    placeholderData: keepPreviousData,
    ...options,
  });
  return { person: data?.person, ...rest };
};

export const usePersons = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{ persons: AdminPerson[] }>,
      FetchError,
      PaginatedResponse<{ persons: AdminPerson[] }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<{ persons: AdminPerson[] }>>(
        `/admin/persons`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: personsQueryKeys.list(query),
    ...options,
  });
  return { persons: data?.persons, count: data?.count, ...rest };
};

export const useCreatePerson = (
  options?: UseMutationOptions<
    { person: AdminPerson },
    FetchError,
    AdminCreatePerson
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdminCreatePerson) =>
      sdk.client.fetch<{ person: AdminPerson }>(`/admin/persons`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

// Agreements (with responses) for a person
export interface PersonAgreementsAPIResponse {
  person_id: string;
  person_name?: string | null;
  person_email?: string | null;
  agreements: any[]; // agreements already include `responses` array from API
  count: number;
}

export const usePersonAgreements = (
  personId: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      PersonAgreementsAPIResponse,
      FetchError,
      PersonAgreementsAPIResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: [PERSONS_QUERY_KEY, personId, "agreements", query],
    queryFn: async () =>
      sdk.client.fetch<PersonAgreementsAPIResponse>(
        `/admin/persons/${personId}/agreements`,
        {
          method: "GET",
          query,
        },
      ),
    placeholderData: keepPreviousData,
    ...options,
  });

  return {
    agreements: data?.agreements,
    count: data?.count,
    person_id: data?.person_id,
    person_name: data?.person_name,
    person_email: data?.person_email,
    ...rest,
  };
};

export const useUpdatePersonMetadata = (
  id: string,
  options?: UseMutationOptions<
    { person: AdminPerson },
    FetchError,
    Record<string, unknown>
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (metadata: Record<string, unknown>) =>
      sdk.client.fetch<{ person: AdminPerson }>(`/admin/persons/${id}`,
        {
          method: "POST",
          body: { metadata },
        },
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      // Invalidate all person detail variants (different field expansions)
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export type SendAgreementToPersonPayload = {
  agreement_id: string;
  template_key: string;
};

export type SendAgreementToPersonResponse = {
  message: string;
  person_id: string;
  agreement_id: string;
  agreement_response: any;
  person_agreement_link: any;
  email_result: any;
  stats_updated: any;
};

export const useSendAgreementToPerson = (
  personId: string,
  options?: UseMutationOptions<
    SendAgreementToPersonResponse,
    FetchError,
    SendAgreementToPersonPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SendAgreementToPersonPayload) =>
      sdk.client.fetch<SendAgreementToPersonResponse>(
        `/admin/persons/${personId}/agreements/send`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      // Invalidate all person detail variants and the agreements fetch
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      queryClient.invalidateQueries({ queryKey: [PERSONS_QUERY_KEY, personId, "agreements"] });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdatePerson = (
  id: string,
  options?: UseMutationOptions<
    { person: AdminPerson },
    FetchError,
    AdminUpdatePerson
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdminUpdatePerson) =>
      sdk.client.fetch<{ person: AdminPerson }>(`/admin/persons/${id}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      // Invalidate all person detail variants (different field expansions)
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeletePerson = (
  id: string,
  options?: UseMutationOptions<AdminPersonDeleteResponse, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminPersonDeleteResponse>(`/admin/persons/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      // Only invalidate the lists query since the detail no longer exists
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useAddAddressToPerson = (
  personId: string,
  options?: UseMutationOptions<
    { address: AddressDetails },
    FetchError,
    AddressInput
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (addressData: AddressInput) =>
      sdk.client.fetch<{ address: AddressDetails }>(`/admin/persons/${personId}/addresses`, {
        method: "POST",
        body: addressData,
      }),
    onSuccess: (data, variables, context) => {
      // Invalidate all person detail variants to refresh any expanded sections
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.details(),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export interface AddPersonTypesPayload {
  personTypeIds: string[];
}

export const useAddPersonTypes = (
  personId: string,
  options?: UseMutationOptions<
    any, // Use proper typing if available for the response
    FetchError,
    AddPersonTypesPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AddPersonTypesPayload) =>
      sdk.client.fetch(
        `/admin/persons/${personId}/types`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onSuccess: (data, variables, context) => {
      // Invalidate all person detail variants and the persons list
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useBatchPersonGroups = (
  id: string,
  options?: UseMutationOptions<
    AdminPersonResponse,
    FetchError,
    HttpTypes.AdminBatchLink
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: HttpTypes.AdminBatchLink) =>
      sdk.client.fetch<AdminPersonResponse>(
        `/admin/persons/${id}/groups/batch`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.details(),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

/**
 * Hook for importing persons from a CSV file
 */
export const useImportPersons = (options?: UseMutationOptions<any, FetchError, { file: File }>) => {
  return useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await sdk.client.fetch(
        "/admin/persons/import",
        {
          method: "POST",
          body: formData,
          headers: {
            "Content-Type": null,
          },
        }
      );
      
      // Cast the response to get the data
      const data = response as { data: any };
      
      return data;
    },
    ...options,
  });
};


/**
 * Hook for confirming a person import operation
 */
export const useConfirmImportPersons = (
  options?: UseMutationOptions<any, FetchError, string>,
) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (transactionId: string) => {
      const response = await sdk.client.fetch(
        `/admin/persons/import/${transactionId}/confirm`,
        {
          method: "POST",
        }
      );
      
      // Cast the response to get the data
      const data = response as { data: any };
      
      return data;
    },
    onSuccess: (data, variables, context) => {
      // Invalidate the persons list query to refresh the data
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

