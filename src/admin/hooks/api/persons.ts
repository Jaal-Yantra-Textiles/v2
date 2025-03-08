import { FetchError } from "@medusajs/js-sdk";
import { HttpTypes, PaginatedResponse } from "@medusajs/types";
import {
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
  AdminCreatePerson,
  AdminPerson,
  AdminPersonDeleteResponse,
  AdminPersonResponse,
  AdminUpdatePerson,
} from "../api/personandtype";

export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
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
    queryKey: personsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ person: AdminPerson }>(`/admin/persons/${id}`, {
        method: "GET",
        query,
      }),
    ...options,
  });
  return { ...data, ...rest };
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
  return { ...data, ...rest };
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
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.detail(id) });
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
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(id),
      });
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
      // Invalidate person details to refresh the addresses
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      });
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
