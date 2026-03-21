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

type SubscribeResponse = {
  subscription: PartnerSubscription | null
  payment_url?: string | null
  payment_provider?: string
  payment_data?: Record<string, any>
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
    mutationFn: async (payload: { plan_id: string }) => {
      const result = await sdk.client.fetch<SubscribeResponse>(
        "/partners/subscription",
        { method: "POST", body: payload }
      )

      // If the server returns a payment URL, handle the redirect
      if (result.payment_url) {
        if (result.payment_provider === "payu" && result.payment_data) {
          // PayU: create a form and auto-submit (PayU requires form POST)
          redirectToPayU(result.payment_url, result.payment_data)
          // Return a pending state — the page will redirect
          return { subscription: null, payment_url: result.payment_url, payment_provider: "payu" }
        }

        if (result.payment_provider === "stripe") {
          // Stripe: simple redirect to checkout URL
          window.location.href = result.payment_url
          return { subscription: null, payment_url: result.payment_url, payment_provider: "stripe" }
        }
      }

      return result
    },
    onSuccess: (data) => {
      // Only invalidate if subscription was created (free plan / no redirect)
      if (data?.subscription) {
        queryClient.invalidateQueries({
          queryKey: subscriptionQueryKeys.all,
        })
      }
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

/**
 * PayU requires a form POST submission (not a simple redirect).
 * Creates a hidden form with all payment data and auto-submits it.
 */
function redirectToPayU(url: string, data: Record<string, any>) {
  const form = document.createElement("form")
  form.method = "POST"
  form.action = url
  form.style.display = "none"

  for (const [key, value] of Object.entries(data)) {
    if (value != null) {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = key
      input.value = String(value)
      form.appendChild(input)
    }
  }

  document.body.appendChild(form)
  form.submit()
}
