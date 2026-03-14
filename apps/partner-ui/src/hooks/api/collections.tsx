import { FetchError } from "@medusajs/js-sdk"
import { FindParams, HttpTypes, PaginatedResponse } from "@medusajs/types"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { productsQueryKeys } from "./products"

const COLLECTION_QUERY_KEY = "collections" as const
export const collectionsQueryKeys = queryKeysFactory(COLLECTION_QUERY_KEY)

export const useCollection = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      { collection: HttpTypes.AdminCollection },
      FetchError,
      { collection: HttpTypes.AdminCollection },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: collectionsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ collection: HttpTypes.AdminCollection }>(
        `/partners/product-collections/${id}`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCollections = (
  query?: FindParams & HttpTypes.AdminCollectionListParams,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{ collections: HttpTypes.AdminCollection[] }>,
      FetchError,
      PaginatedResponse<{ collections: HttpTypes.AdminCollection[] }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: collectionsQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<
        PaginatedResponse<{ collections: HttpTypes.AdminCollection[] }>
      >("/partners/product-collections", { method: "GET", query }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUpdateCollection = (
  id: string,
  options?: UseMutationOptions<
    { collection: HttpTypes.AdminCollection },
    FetchError,
    HttpTypes.AdminUpdateCollection
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ collection: HttpTypes.AdminCollection }>(
        `/partners/product-collections/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: collectionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: collectionsQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateCollectionProducts = (
  id: string,
  options?: UseMutationOptions<
    { collection: { id: string } },
    FetchError,
    { add?: string[]; remove?: string[] }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ collection: { id: string } }>(
        `/partners/product-collections/${id}/products`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: collectionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: collectionsQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateCollection = (
  options?: UseMutationOptions<
    { collection: HttpTypes.AdminCollection },
    FetchError,
    HttpTypes.AdminCreateCollection
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ collection: HttpTypes.AdminCollection }>(
        "/partners/product-collections",
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: collectionsQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteCollection = (
  id: string,
  options?: UseMutationOptions<
    { id: string; object: string; deleted: boolean },
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ id: string; object: string; deleted: boolean }>(
        `/partners/product-collections/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: collectionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: collectionsQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
