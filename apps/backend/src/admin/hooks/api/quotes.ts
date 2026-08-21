import { FetchError } from "@medusajs/js-sdk"
import {
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

const QUOTES_QUERY_KEY = "quotes" as const
export const quoteQueryKeys = queryKeysFactory(QUOTES_QUERY_KEY)

export type AdminQuote = Record<string, any> & {
  id: string
  partner_id: string
  store_id?: string | null
  recipient_name?: string | null
  recipient_company?: string | null
  email_sent_to?: string | null
  currency_code?: string
  destination_country_code?: string
  quoted_landed_total?: number | null
  quoted_freight?: number | null
  status?: "active" | "revoked"
  expires_at?: string | null
  view_count?: number
  last_viewed_at?: string | null
  created_at?: string
}

export type AdminQuoteListResponse = { quotes: AdminQuote[]; count: number }

export type AdminMintQuotePayload = {
  partner_id: string
  buyer_email: string
  recipient_name?: string | null
  recipient_company?: string | null
  partner_note?: string | null
  lines: Array<{ variant_id: string; quantity: number; note?: string | null }>
  destination_country_code: string
  destination_postal_code?: string | null
  destination_city?: string | null
  currency_code: string
  carrier?: string
  ttl_days?: number
}

/**
 * 🔴 `token` arrives ONCE, on the mint response, and is never retrievable —
 * only its sha256 is stored. Nothing in this file may cache it, and no list
 * query can reconstruct it. The UI must present it as a copy-now-or-lose-it
 * value, exactly as the partner surface already does.
 */
export type AdminMintQuoteResponse = { quote: AdminQuote; token: string }

export const useQuotes = (
  query?: { partner_id?: string; status?: string },
  options?: Omit<
    UseQueryOptions<AdminQuoteListResponse, FetchError, AdminQuoteListResponse, any>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: quoteQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<AdminQuoteListResponse>("/admin/quotes", {
        method: "GET",
        query,
      }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useQuote = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ quote: AdminQuote }, FetchError, { quote: AdminQuote }, any>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: quoteQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ quote: AdminQuote }>(`/admin/quotes/${id}`, {
        method: "GET",
      }),
    enabled: !!id,
    ...options,
  })

  return { ...data, ...rest }
}

export const useMintQuote = (
  options?: UseMutationOptions<
    AdminMintQuoteResponse,
    FetchError,
    AdminMintQuotePayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<AdminMintQuoteResponse>("/admin/quotes", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: quoteQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useRevokeQuote = (
  options?: UseMutationOptions<
    { quote: AdminQuote; price_list_deleted?: boolean },
    FetchError,
    string
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id) =>
      sdk.client.fetch<{ quote: AdminQuote; price_list_deleted?: boolean }>(
        `/admin/quotes/${id}/revoke`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: quoteQueryKeys.lists() })
      // The detail carries the status badge AND the activity timeline the
      // revoke just appended to, so it is stale the moment this returns.
      queryClient.invalidateQueries({
        queryKey: quoteQueryKeys.detail(variables),
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
