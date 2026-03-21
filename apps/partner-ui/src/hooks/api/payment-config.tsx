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
  created_at: string
  updated_at: string
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
