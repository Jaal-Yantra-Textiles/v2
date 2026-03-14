import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes, FindParams, PaginatedResponse } from "@medusajs/types"
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

const CATEGORIES_QUERY_KEY = "categories" as const
export const categoriesQueryKeys = queryKeysFactory(CATEGORIES_QUERY_KEY)

export const useProductCategory = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { product_category: HttpTypes.AdminProductCategory },
      FetchError,
      { product_category: HttpTypes.AdminProductCategory },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: categoriesQueryKeys.detail(id, query),
    queryFn: async () =>
      sdk.client.fetch<{ product_category: HttpTypes.AdminProductCategory }>(
        `/partners/product-categories/${id}`,
        { method: "GET", query }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const useProductCategories = (
  query?: FindParams & HttpTypes.AdminProductCategoryListParams,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{
        product_categories: HttpTypes.AdminProductCategory[]
      }>,
      FetchError,
      PaginatedResponse<{
        product_categories: HttpTypes.AdminProductCategory[]
      }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: categoriesQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<
        PaginatedResponse<{
          product_categories: HttpTypes.AdminProductCategory[]
        }>
      >("/partners/product-categories", { method: "GET", query }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateProductCategory = (
  options?: UseMutationOptions<
    { product_category: HttpTypes.AdminProductCategory },
    FetchError,
    HttpTypes.AdminCreateProductCategory
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product_category: HttpTypes.AdminProductCategory }>(
        "/partners/product-categories",
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: categoriesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProductCategory = (
  id: string,
  options?: UseMutationOptions<
    { product_category: HttpTypes.AdminProductCategory },
    FetchError,
    HttpTypes.AdminUpdateProductCategory
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product_category: HttpTypes.AdminProductCategory }>(
        `/partners/product-categories/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: categoriesQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: categoriesQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteProductCategory = (
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
        `/partners/product-categories/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: categoriesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: categoriesQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateProductCategoryProducts = (
  id: string,
  options?: UseMutationOptions<
    { product_category: { id: string } },
    FetchError,
    { add?: string[]; remove?: string[] }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ product_category: { id: string } }>(
        `/partners/product-categories/${id}/products`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: categoriesQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: categoriesQueryKeys.details(),
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
