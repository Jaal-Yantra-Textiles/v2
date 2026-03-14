import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const SHIPPING_OPTION_TYPES_QUERY_KEY = "shipping_option_types" as const
export const shippingOptionTypesQueryKeys = queryKeysFactory(
  SHIPPING_OPTION_TYPES_QUERY_KEY
)

export const useShippingOptionType = (
  id: string,
  query?: HttpTypes.SelectParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminShippingOptionTypeResponse,
      FetchError,
      HttpTypes.AdminShippingOptionTypeResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionTypeResponse>(
        `/partners/shipping-option-types/${id}`,
        { method: "GET" }
      ),
    queryKey: shippingOptionTypesQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useShippingOptionTypes = (
  query?: HttpTypes.AdminShippingOptionTypeListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminShippingOptionTypeListResponse,
      FetchError,
      HttpTypes.AdminShippingOptionTypeListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionTypeListResponse>(
        `/partners/shipping-option-types`,
        { method: "GET" }
      ),
    queryKey: shippingOptionTypesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateShippingOptionType = (
  options?: UseMutationOptions<
    HttpTypes.AdminShippingOptionTypeResponse,
    FetchError,
    HttpTypes.AdminCreateShippingOptionType
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionTypeResponse>(
        `/partners/shipping-option-types`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: shippingOptionTypesQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateShippingOptionType = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminShippingOptionTypeResponse,
    FetchError,
    HttpTypes.AdminUpdateShippingOptionType
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionTypeResponse>(
        `/partners/shipping-option-types/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: shippingOptionTypesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: shippingOptionTypesQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteShippingOptionType = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminShippingOptionTypeDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<HttpTypes.AdminShippingOptionTypeDeleteResponse>(
        `/partners/shipping-option-types/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: shippingOptionTypesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: shippingOptionTypesQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
