import { FetchError } from "@medusajs/js-sdk"
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

const PAYMENT_CONFIG_QUERY_KEY = "payment_config" as const
export const paymentConfigQueryKeys = queryKeysFactory(PAYMENT_CONFIG_QUERY_KEY)

export type PaymentConfig = {
  id: string
  partner_id: string
  provider_id: string
  credentials: Record<string, any>
  is_active: boolean
  metadata?: Record<string, any>
  // JYT Stripe Connect (Standard) — populated for pp_stripe_stripe when the
  // partner onboards via JYT instead of bringing their own keys.
  connect_account_id?: string | null
  connect_status?: "pending" | "active" | "restricted" | "disconnected" | null
  connect_charges_enabled?: boolean
  connect_payouts_enabled?: boolean
  connect_details_submitted?: boolean
  created_at: string
  updated_at: string
}

export type StripeConnectStatus = {
  // Whether the partner is on the EUR/Stripe Connect rail. False for India
  // (PayU/INR) and non-EUR partners — the UI hides the card entirely.
  eligible: boolean
  connected: boolean
  account_id: string | null
  status: "pending" | "active" | "restricted" | "disconnected" | null
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
}

export type CreatePaymentConfigPayload = {
  provider_id: "pp_payu_payu" | "pp_stripe_stripe"
  credentials: {
    merchant_key?: string
    merchant_salt?: string
    mode?: "test" | "live"
    api_key?: string
  }
  is_active?: boolean
  metadata?: Record<string, any>
}

export type UpdatePaymentConfigPayload = {
  credentials?: {
    merchant_key?: string
    merchant_salt?: string
    mode?: "test" | "live"
    api_key?: string
  }
  is_active?: boolean
  metadata?: Record<string, any>
}

export const usePaymentConfigs = (
  options?: Omit<
    UseQueryOptions<
      { payment_configs: PaymentConfig[] },
      FetchError,
      { payment_configs: PaymentConfig[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: paymentConfigQueryKeys.lists(),
    queryFn: () =>
      sdk.client.fetch<{ payment_configs: PaymentConfig[] }>(
        "/partners/payment-config",
        { method: "GET" }
      ),
    ...options,
  })

  return { payment_configs: data?.payment_configs || [], ...rest }
}

export const useCreatePaymentConfig = (
  options?: UseMutationOptions<
    { payment_config: PaymentConfig },
    FetchError,
    CreatePaymentConfigPayload
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ payment_config: PaymentConfig }>(
        "/partners/payment-config",
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: paymentConfigQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdatePaymentConfig = (
  configId: string,
  options?: UseMutationOptions<
    { payment_config: PaymentConfig },
    FetchError,
    UpdatePaymentConfigPayload
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ payment_config: PaymentConfig }>(
        `/partners/payment-config/${configId}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: paymentConfigQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

const STRIPE_CONNECT_QUERY_KEY = "stripe_connect" as const
export const stripeConnectQueryKeys = queryKeysFactory(STRIPE_CONNECT_QUERY_KEY)

/**
 * Current JYT Stripe Connect status for the partner. Server live-syncs from
 * Stripe on each read, so this reflects onboarding completion immediately.
 */
export const useStripeConnectStatus = (
  options?: Omit<
    UseQueryOptions<
      { stripe_connect: StripeConnectStatus },
      FetchError,
      { stripe_connect: StripeConnectStatus },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: stripeConnectQueryKeys.details(),
    queryFn: () =>
      sdk.client.fetch<{ stripe_connect: StripeConnectStatus }>(
        "/partners/payment-config/stripe-connect",
        { method: "GET" }
      ),
    ...options,
  })

  return { stripe_connect: data?.stripe_connect, ...rest }
}

/**
 * Start (or resume) JYT Stripe Connect onboarding. Returns a Stripe-hosted
 * onboarding URL to redirect the partner to.
 */
export const useStartStripeConnect = (
  options?: UseMutationOptions<
    { url: string; account_id: string },
    FetchError,
    { return_url: string; refresh_url?: string }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ url: string; account_id: string }>(
        "/partners/payment-config/stripe-connect",
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: stripeConnectQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeletePaymentConfig = (
  options?: UseMutationOptions<any, FetchError, string>
) => {
  return useMutation({
    mutationFn: (configId: string) =>
      sdk.client.fetch(`/partners/payment-config/${configId}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: paymentConfigQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
