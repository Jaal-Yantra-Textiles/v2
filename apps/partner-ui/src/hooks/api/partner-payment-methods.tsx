import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import qs from "qs"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_PAYMENT_METHODS_QUERY_KEY = "partner-payment-methods" as const
export const partnerPaymentMethodsQueryKeys = queryKeysFactory(
  PARTNER_PAYMENT_METHODS_QUERY_KEY
)

export type PartnerPaymentMethod = {
  id: string
  type: string
  account_name: string
  account_number?: string | null
  bank_name?: string | null
  ifsc_code?: string | null
  wallet_id?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}

export type PartnerPaymentMethodsResponse = {
  paymentMethods: PartnerPaymentMethod[]
  count: number
  offset: number
  limit: number
}

export type ListPartnerPaymentMethodsParams = {
  limit?: number
  offset?: number
}

export type CreatePartnerPaymentMethodPayload = {
  type: "bank_account" | "cash_account" | "digital_wallet"
  account_name: string
  account_number?: string
  bank_name?: string
  ifsc_code?: string
  wallet_id?: string
  metadata?: Record<string, any> | null
}

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}

export const usePartnerPaymentMethods = (
  partnerId?: string | null,
  params?: ListPartnerPaymentMethodsParams,
  options?: Omit<
    UseQueryOptions<
      PartnerPaymentMethodsResponse,
      FetchError,
      PartnerPaymentMethodsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerPaymentMethodsQueryKeys.list({
      partnerId: partnerId || "",
      ...params,
    }),
    queryFn: async () => {
      if (!partnerId) {
        return { paymentMethods: [], count: 0, offset: 0, limit: 50 }
      }

      const q = buildQuery(params)
      return await sdk.client.fetch<PartnerPaymentMethodsResponse>(
        `/partners/${partnerId}/payments/methods${q}`,
        { method: "GET" }
      )
    },
    enabled: !!partnerId,
    ...options,
  })

  return {
    ...data,
    paymentMethods: data?.paymentMethods ?? [],
    ...rest,
  }
}

export const useCreatePartnerPaymentMethod = (
  partnerId: string,
  options?: UseMutationOptions<
    { paymentMethod: PartnerPaymentMethod },
    FetchError,
    CreatePartnerPaymentMethodPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreatePartnerPaymentMethodPayload) =>
      sdk.client.fetch<{ paymentMethod: PartnerPaymentMethod }>(
        `/partners/${partnerId}/payments/methods`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerPaymentMethodsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
