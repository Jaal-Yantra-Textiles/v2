import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { fulfillmentProvidersQueryKeys } from "./fulfillment-providers"
import { usePartnerStores } from "./partner-stores"

const STOCK_LOCATIONS_QUERY_KEY = "stock_locations" as const
export const stockLocationsQueryKeys = queryKeysFactory(
  STOCK_LOCATIONS_QUERY_KEY
)

export const useStockLocation = (
  id: string,
  query?: HttpTypes.SelectParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminStockLocationResponse,
      FetchError,
      HttpTypes.AdminStockLocationResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminStockLocationResponse>(
        `/partners/stores/${storeId}/locations/${id}`,
        { method: "GET" }
      ),
    queryKey: stockLocationsQueryKeys.detail(id, query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useStockLocations = (
  query?: HttpTypes.AdminStockLocationListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminStockLocationListResponse,
      FetchError,
      HttpTypes.AdminStockLocationListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminStockLocationListResponse>(
        `/partners/stores/${storeId}/locations`,
        { method: "GET" }
      ),
    queryKey: stockLocationsQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateStockLocation = (
  options?: UseMutationOptions<
    HttpTypes.AdminStockLocationResponse,
    FetchError,
    HttpTypes.AdminCreateStockLocation
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.stockLocation.create(payload),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateStockLocation = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminStockLocationResponse,
    FetchError,
    HttpTypes.AdminUpdateStockLocation
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<HttpTypes.AdminStockLocationResponse>(
        `/partners/stores/${storeId}/locations/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.details(),
      })
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateStockLocationSalesChannels = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminStockLocationResponse,
    FetchError,
    HttpTypes.AdminUpdateStockLocationSalesChannels
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.admin.stockLocation.updateSalesChannels(id, payload),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.details(),
      })
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteStockLocation = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminStockLocationDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () => sdk.admin.stockLocation.delete(id),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.lists(),
      })
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateStockLocationFulfillmentSet = (
  locationId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminStockLocationResponse,
    FetchError,
    HttpTypes.AdminCreateStockLocationFulfillmentSet
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<HttpTypes.AdminStockLocationResponse>(
        `/partners/stores/${storeId}/locations/${locationId}/fulfillment-sets`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.all,
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateStockLocationFulfillmentProviders = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminStockLocationResponse,
    FetchError,
    HttpTypes.AdminBatchLink
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<HttpTypes.AdminStockLocationResponse>(
        `/partners/stores/${storeId}/locations/${id}/fulfillment-providers`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.details(),
      })
      await queryClient.invalidateQueries({
        queryKey: fulfillmentProvidersQueryKeys.all,
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
