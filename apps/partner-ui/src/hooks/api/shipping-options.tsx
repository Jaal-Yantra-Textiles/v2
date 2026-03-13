import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { stockLocationsQueryKeys } from "./stock-locations"
import { usePartnerStores } from "./partner-stores"

const SHIPPING_OPTIONS_QUERY_KEY = "shipping_options" as const
export const shippingOptionsQueryKeys = queryKeysFactory(
  SHIPPING_OPTIONS_QUERY_KEY
)

export const useShippingOption = (
  id: string,
  query?: Record<string, any>,
  options?: UseQueryOptions<
    HttpTypes.AdminShippingOptionResponse,
    Error,
    HttpTypes.AdminShippingOptionResponse,
    QueryKey
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionResponse>(
        `/partners/stores/${storeId}/shipping-options/${id}`,
        { method: "GET" }
      ),
    queryKey: shippingOptionsQueryKeys.detail(id),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useShippingOptions = (
  query?: HttpTypes.AdminShippingOptionListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminShippingOptionListResponse,
      FetchError,
      HttpTypes.AdminShippingOptionListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionListResponse>(
        `/partners/stores/${storeId}/shipping-options`,
        { method: "GET" }
      ),
    queryKey: shippingOptionsQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateShippingOptions = (
  options?: UseMutationOptions<
    HttpTypes.AdminShippingOptionResponse,
    FetchError,
    HttpTypes.AdminCreateShippingOption
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionResponse>(
        `/partners/stores/${storeId}/shipping-options`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.all,
      })
      queryClient.invalidateQueries({
        queryKey: shippingOptionsQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateShippingOptions = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminShippingOptionResponse,
    FetchError,
    HttpTypes.AdminUpdateShippingOption
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionResponse>(
        `/partners/stores/${storeId}/shipping-options/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.all,
      })
      queryClient.invalidateQueries({
        queryKey: shippingOptionsQueryKeys.all,
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteShippingOption = (
  optionId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminShippingOptionDeleteResponse,
    FetchError,
    void
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionDeleteResponse>(
        `/partners/stores/${storeId}/shipping-options/${optionId}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: stockLocationsQueryKeys.all,
      })
      queryClient.invalidateQueries({
        queryKey: shippingOptionsQueryKeys.all,
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
