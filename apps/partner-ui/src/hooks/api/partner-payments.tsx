import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"
import qs from "qs"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_PAYMENTS_QUERY_KEY = "partner-payments" as const
export const partnerPaymentsQueryKeys = queryKeysFactory(PARTNER_PAYMENTS_QUERY_KEY)

export type PartnerPayment = {
  id: string
  amount?: number | null
  currency_code?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}

export type PartnerPaymentsResponse = {
  payments: PartnerPayment[]
  count?: number
  limit?: number
  offset?: number
}

export type ListPartnerPaymentsParams = {
  limit?: number
  offset?: number
}

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}

export const usePartnerPayments = (
  partnerId?: string | null,
  params?: ListPartnerPaymentsParams,
  options?: Omit<
    UseQueryOptions<
      PartnerPaymentsResponse,
      FetchError,
      PartnerPaymentsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerPaymentsQueryKeys.list({ partnerId: partnerId || "", ...params }),
    queryFn: async () => {
      if (!partnerId) {
        return { payments: [] }
      }

      const q = buildQuery(params)
      return await sdk.client.fetch<PartnerPaymentsResponse>(
        `/partners/${partnerId}/payments${q}`,
        { method: "GET" }
      )
    },
    enabled: !!partnerId,
    ...options,
  })

  return {
    ...data,
    payments: data?.payments ?? [],
    ...rest,
  }
}
