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
  AdminCreatePersonType,
  AdminPersonType,
  AdminPersonTypeDeleteResponse,
  AdminPersonTypeResponse,
  AdminUpdatePersonType,
} from "../api/personandtype";

const PERSONS_TYPE_QUERY_KEY = "persontype" as const;
export const personTypeQueryKeys = queryKeysFactory(PERSONS_TYPE_QUERY_KEY);

export const usePersonType = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { personType: AdminPersonType },
      FetchError,
      { personType: AdminPersonType },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: personTypeQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ personType: AdminPersonType }>(
        `/admin/persontypes/${id}`,
        {
          method: "GET",
          query,
        },
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const usePersonTypes = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{ personTypes: AdminPersonType[] }>,
      FetchError,
      PaginatedResponse<{ personTypes: AdminPersonType[] }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<{ personTypes: AdminPersonType[] }>>(
        `/admin/persontypes`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: personTypeQueryKeys.list(query),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreatePersonType = (
  options?: UseMutationOptions<
    { personType: AdminPersonType },
    FetchError,
    AdminCreatePersonType
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdminCreatePersonType) => {
      console.log("Mutation starting with payload:", payload);
      const response = sdk.client.fetch<{ personType: AdminPersonType }>(
        `/admin/persontypes`,
        {
          method: "POST",
          body: payload,
        },
      );
      console.log("Mutation response:", response);
      return response;
    },

    onMutate: async (variables: AdminCreatePersonType) => {
      console.log("onMutate called with:", variables);
      // Optional: Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: personTypeQueryKeys.lists(),
      });
    },
    onSuccess: async (data, variables, context) => {
      try {
        await queryClient.invalidateQueries({
          queryKey: personTypeQueryKeys.lists(),
          refetchType: "all",
          exact: false,
        });
        console.log("Query invalidation completed");
      } catch (error) {
        console.error("Query invalidation failed:", error);
      }

      if (options?.onSuccess) {
        await options.onSuccess(data, variables, context);
      }
    },
    onError: (error) => {
      console.error("Mutation error:", error);
    },
    onSettled: () => {
      console.log("onSettled called");
    },
  });
};

export const useUpdatePersonType = (
  id: string,
  options?: UseMutationOptions<
    { personType: AdminPersonType },
    FetchError,
    AdminUpdatePersonType
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdminUpdatePersonType) =>
      sdk.client.fetch<{ personType: AdminPersonType }>(
        `/admin/persontypes/${id}`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: personTypeQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: personTypeQueryKeys.detail(id),
        refetchType: "all",
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
/**
 *
 * @param id Provide a person type ID, deletes the resource based on the ID
 * @param options MutationFunc and OnSuccess
 * @returns onSucess and onError
 */
export const useDeletePersonType = (
  id: string,
  options?: UseMutationOptions<AdminPersonTypeDeleteResponse, FetchError, void>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      console.log("Delete mutation starting for id:", id);
      const response = await sdk.client.fetch<AdminPersonTypeDeleteResponse>(
        `/admin/persontype/${id}`,
        {
          method: "DELETE",
        },
      );
      console.log("Delete response:", response);
      if (!response || !response.deleted) {
        throw new Error("Delete operation failed");
      }
      return response;
    },
    onMutate: async () => {
      console.log("onMutate called for delete operation");
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: personTypeQueryKeys.lists(),
      });
    },
    onSuccess: async (data, variables, context) => {
      console.log("Delete onSuccess starting");

      try {
        // Force refetch all person type queries
        await queryClient.invalidateQueries({
          queryKey: personTypeQueryKeys.lists(),
          refetchType: "all",
          exact: false,
        });

        // Remove the specific item from cache
        queryClient.removeQueries({
          queryKey: personTypeQueryKeys.detail(id),
          exact: true,
        });

        console.log("Query invalidation completed");
      } catch (error) {
        console.error("Query invalidation failed:", error);
      }

      if (options?.onSuccess) {
        await options.onSuccess(data, variables, context);
      }
    },
    onError: (error) => {
      console.error("Delete mutation error:", error);
      queryClient.invalidateQueries({
        queryKey: personTypeQueryKeys.lists(),
      });
    },
    onSettled: async () => {
      console.log("Delete operation settled");
      // Force a refetch as a fallback
      await queryClient.invalidateQueries({
        queryKey: personTypeQueryKeys.lists(),
        refetchType: "all",
      });
    },
    ...options,
  });
};

export const useBatchPersonGroups = (
  id: string,
  options?: UseMutationOptions<
    AdminPersonTypeResponse,
    FetchError,
    HttpTypes.AdminBatchLink
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: HttpTypes.AdminBatchLink) =>
      sdk.client.fetch<AdminPersonTypeResponse>(
        `/admin/persontype/${id}/groups/batch`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personTypeQueryKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: personTypeQueryKeys.details(),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
