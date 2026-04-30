import { FetchError } from "@medusajs/js-sdk"
import {
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const WEBSITE_ANALYTICS_QUERY_KEY = "website-analytics" as const
export const websiteAnalyticsQueryKeys = queryKeysFactory(
  WEBSITE_ANALYTICS_QUERY_KEY
)

export type AnalyticsProvider = "in_house" | "custom" | "off"

export type WebsiteAnalytics = {
  website_id: string
  domain: string
  provider: AnalyticsProvider
  custom_head: string | null
  custom_body_end: string | null
}

export type WebsiteAnalyticsResponse = { analytics: WebsiteAnalytics }

export type UpdateWebsiteAnalyticsPayload = {
  provider?: AnalyticsProvider
  custom_head?: string | null
  custom_body_end?: string | null
}

export const useWebsiteAnalytics = (
  options?: Omit<
    UseQueryOptions<
      WebsiteAnalyticsResponse,
      FetchError,
      WebsiteAnalyticsResponse,
      ReturnType<typeof websiteAnalyticsQueryKeys.details>
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: websiteAnalyticsQueryKeys.details(),
    queryFn: async () =>
      sdk.client.fetch<WebsiteAnalyticsResponse>(
        "/partners/storefront/website/analytics",
        { method: "GET" }
      ),
    ...options,
  })
  return { analytics: data?.analytics, ...rest }
}

export const useUpdateWebsiteAnalytics = (
  options?: UseMutationOptions<
    WebsiteAnalyticsResponse,
    FetchError,
    UpdateWebsiteAnalyticsPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<WebsiteAnalyticsResponse>(
        "/partners/storefront/website/analytics",
        {
          method: "PUT",
          body: payload,
        }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: websiteAnalyticsQueryKeys.details(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
