import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
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

const PRODUCT_TYPES_QUERY_KEY = "product_types" as const
export const productTypesQueryKeys = queryKeysFactory(PRODUCT_TYPES_QUERY_KEY)

export const useProductType = (
  id: string,
  query?: HttpTypes.AdminProductTypeParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminProductTypeResponse,
      FetchError,
      HttpTypes.AdminProductTypeResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminProductTypeResponse>(
        `/partners/product-types/${id}`,
        { method: "GET" }
      ),
    queryKey: productTypesQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useProductTypes = (
  query?: HttpTypes.AdminProductTypeListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminProductTypeListResponse,
      FetchError,
      HttpTypes.AdminProductTypeListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminProductTypeListResponse>(
        "/partners/product-types",
        { method: "GET", query }
      ),
    queryKey: productTypesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateProductType = (
  options?: UseMutationOptions<
    { product_type: HttpTypes.AdminProductType },
    FetchError,
    HttpTypes.AdminCreateProductType
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product_type: HttpTypes.AdminProductType }>(
        "/partners/product-types",
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: productTypesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProductType = (
  id: string,
  options?: UseMutationOptions<
    { product_type: HttpTypes.AdminProductType },
    FetchError,
    HttpTypes.AdminUpdateProductType
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product_type: HttpTypes.AdminProductType }>(
        `/partners/product-types/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: productTypesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: productTypesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteProductType = (
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
        `/partners/product-types/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: productTypesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: productTypesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
