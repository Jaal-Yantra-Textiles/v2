import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type PartnerPlan = {
  id: string
  name: string
  slug: string
  description?: string
  price: number
  currency_code: string
  interval: string
  features?: Record<string, unknown>
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type PartnerSubscription = {
  id: string
  partner_id: string
  status: "active" | "canceled" | "expired" | "past_due"
  current_period_start: string
  current_period_end?: string
  canceled_at?: string
  plan?: PartnerPlan
  created_at: string
  updated_at: string
}

const SUBSCRIPTION_QUERY_KEY = "partner_subscription" as const
export const subscriptionQueryKeys = queryKeysFactory(SUBSCRIPTION_QUERY_KEY)

export const usePartnerSubscription = (
  options?: Omit<
    UseQueryOptions<
      { subscription: PartnerSubscription | null; plans: PartnerPlan[]; recommended_provider?: string },
      FetchError,
      { subscription: PartnerSubscription | null; plans: PartnerPlan[]; recommended_provider?: string },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{
        subscription: PartnerSubscription | null
        plans: PartnerPlan[]
        recommended_provider?: string
      }>("/partners/subscription", { method: "GET" }),
    queryKey: subscriptionQueryKeys.detail("current"),
    ...options,
  })
  return {
    subscription: data?.subscription || null,
    plans: data?.plans || [],
    recommended_provider: data?.recommended_provider || "manual",
    ...rest,
  }
}

export const useSubscribeToPlan = () => {
  return useMutation({
    mutationFn: (payload: { plan_id: string }) =>
      sdk.client.fetch<{ subscription: PartnerSubscription }>(
        "/partners/subscription",
        { method: "POST", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: subscriptionQueryKeys.all,
      })
    },
  })
}

export const useCancelSubscription = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch("/partners/subscription", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: subscriptionQueryKeys.all,
      })
    },
  })
}
