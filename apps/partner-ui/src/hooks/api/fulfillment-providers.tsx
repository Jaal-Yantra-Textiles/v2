import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { QueryKey, useQuery, UseQueryOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const FULFILLMENT_PROVIDERS_QUERY_KEY = "fulfillment_providers" as const
export const fulfillmentProvidersQueryKeys = queryKeysFactory(
  FULFILLMENT_PROVIDERS_QUERY_KEY
)

const FULFILLMENT_PROVIDER_OPTIONS_QUERY_KEY =
  "fulfillment_provider_options" as const
export const fulfillmentProviderOptionsQueryKeys = queryKeysFactory(
  FULFILLMENT_PROVIDER_OPTIONS_QUERY_KEY
)

export const useFulfillmentProviders = (
  query?: HttpTypes.AdminFulfillmentProviderListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminFulfillmentProviderListResponse,
      FetchError,
      HttpTypes.AdminFulfillmentProviderListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminFulfillmentProviderListResponse>(
        `/partners/fulfillment-providers`,
        { method: "GET" }
      ),
    queryKey: fulfillmentProvidersQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useFulfillmentProviderOptions = (
  providerId: string,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminFulfillmentProviderOptionsListResponse,
      FetchError,
      HttpTypes.AdminFulfillmentProviderOptionsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<HttpTypes.AdminFulfillmentProviderOptionsListResponse>(
        `/partners/fulfillment-providers/${providerId}/options`,
        { method: "GET" }
      ),
    queryKey: fulfillmentProviderOptionsQueryKeys.list(providerId),
    ...options,
  })

  return { ...data, ...rest }
}
