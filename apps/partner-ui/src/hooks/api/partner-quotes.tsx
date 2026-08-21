import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import qs from "qs"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_QUOTES_QUERY_KEY = "partner-quotes" as const
export const partnerQuotesQueryKeys = queryKeysFactory(
  PARTNER_QUOTES_QUERY_KEY
)

export type PartnerQuoteLine = {
  id: string
  variant_id: string
  product_id?: string | null
  quantity: number
  position: number
  quoted_unit_amount?: number | null
  quoted_subtotal?: number | null
  quoted_unit_weight_grams?: number | null
  /**
   * Which level the weight came from. A product-level fallback over-quotes a
   * lighter variant, so the provenance is shown rather than hidden.
   */
  quoted_weight_source?: "variant" | "product" | null
  note?: string | null
}

export type PartnerQuote = {
  id: string
  partner_id: string
  store_id?: string | null
  lines?: PartnerQuoteLine[]

  destination_country_code: string
  destination_postal_code?: string | null
  destination_city?: string | null

  currency_code: string
  region_id?: string | null

  recipient_name?: string | null
  recipient_company?: string | null
  email_sent_to?: string | null
  partner_note?: string | null

  quoted_subtotal?: number | null
  quoted_freight?: number | null
  quoted_landed_total?: number | null
  quoted_weight_grams?: number | null
  quoted_at?: string | null

  status: "active" | "revoked" | "superseded"
  expires_at?: string | null

  viewed_at?: string | null
  last_viewed_at?: string | null
  view_count: number

  created_by?: string | null
  created_at?: string
  updated_at?: string
}

export type PartnerQuoteListResponse = {
  quotes: PartnerQuote[]
  count: number
}

/**
 * 🔴 `token` is returned by the mint and NEVER again — only its sha256 is
 * persisted, so a database read cannot reconstruct a working link. The screen
 * that calls this owns the only copy; if it navigates away without surfacing
 * it, the quote has to be re-minted.
 */
export type MintPartnerQuoteResponse = {
  quote: PartnerQuote
  token: string
}

export type MintPartnerQuotePayload = {
  buyer_email: string
  recipient_name?: string | null
  recipient_company?: string | null
  partner_note?: string | null
  lines: {
    variant_id: string
    quantity: number
    position?: number
    note?: string | null
  }[]
  destination_country_code: string
  destination_postal_code?: string | null
  destination_city?: string | null
  currency_code: string
  region_id?: string | null
  carrier?: string
  ttl_days?: number
}

export type ListPartnerQuotesParams = {
  limit?: number
  offset?: number
}

export const usePartnerQuotes = (
  params?: ListPartnerQuotesParams,
  options?: Omit<
    UseQueryOptions<
      PartnerQuoteListResponse,
      FetchError,
      PartnerQuoteListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerQuotesQueryKeys.list(params),
    queryFn: async () => {
      const q = qs.stringify(params || {}, { skipNulls: true })
      return await sdk.client.fetch<PartnerQuoteListResponse>(
        `/partners/quotes${q ? `?${q}` : ""}`,
        { method: "GET" }
      )
    },
    ...options,
  })

  return {
    ...data,
    quotes: data?.quotes ?? [],
    count: data?.count ?? 0,
    ...rest,
  }
}

export type PartnerQuoteEvent = {
  id: string
  type: string
  actor_type: "partner" | "admin" | "buyer" | "system"
  actor_id?: string | null
  message?: string | null
  data?: Record<string, unknown> | null
  created_at: string
}

export type PartnerQuoteDetailResponse = {
  quote: PartnerQuote & { events?: PartnerQuoteEvent[] }
}

/**
 * One of the partner's own quotes, with its lines and activity.
 *
 * 🔴 The response carries no token and never can — only its sha256 is stored,
 * so no read can rebuild the buyer link. The detail view says so rather than
 * offering a copy button that cannot work.
 */
export const usePartnerQuote = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      PartnerQuoteDetailResponse,
      FetchError,
      PartnerQuoteDetailResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerQuotesQueryKeys.detail(id),
    queryFn: async () =>
      await sdk.client.fetch<PartnerQuoteDetailResponse>(
        `/partners/quotes/${id}`,
        { method: "GET" }
      ),
    enabled: !!id,
    ...options,
  })

  return { quote: data?.quote, ...rest }
}

export const useMintPartnerQuote = (
  options?: UseMutationOptions<
    MintPartnerQuoteResponse,
    FetchError,
    MintPartnerQuotePayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<MintPartnerQuoteResponse>(
        "/partners/quotes",
        { method: "POST", body: payload }
      )
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerQuotesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/** One named reason a basket cannot be quoted (#1445). */
export type QuoteReadinessIssue = {
  code: string
  severity: "blocking" | "warning"
  /** Written for the partner looking at the wizard, not for a log. */
  message: string
  variant_id?: string | null
  data?: Record<string, unknown>
}

export type QuoteReadiness = {
  ready: boolean
  issues: QuoteReadinessIssue[]
  blocking_count: number
  warning_count: number
  freight: {
    chosen: { name: string | null; amount: number; currency_code: string } | null
    total_weight_grams: number | null
    error: string | null
  }
}

export type QuoteReadinessPayload = {
  lines: Array<{ variant_id: string; quantity: number }>
  destination_country_code: string
  destination_postal_code?: string | null
  destination_city?: string | null
  currency_code: string
  region_id?: string | null
  carrier?: string
}

/**
 * The mint preflight (#1445).
 *
 * 🔴 A mutation rather than a query even though it writes nothing: the input is
 * a whole basket, so it is POSTed, and it must run on demand when the partner
 * reaches the last step — not on every keystroke of a quantity field, which is
 * what a `useQuery` keyed on the form state would do. It prices every line and
 * asks a carrier; that is not a thing to fire per render.
 *
 * The mint runs the same assessor server-side, so skipping this changes what
 * the partner SEES, never what the platform accepts.
 */
export const useQuoteReadiness = (
  options?: UseMutationOptions<
    { readiness: QuoteReadiness },
    FetchError,
    QuoteReadinessPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<{ readiness: QuoteReadiness }>(
        "/partners/quotes/readiness",
        { method: "POST", body: payload }
      ),
    ...options,
  })
}
