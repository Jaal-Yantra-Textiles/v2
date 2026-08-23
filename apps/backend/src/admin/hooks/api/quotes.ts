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

/**
 * What the buyer still owes on an accepted quote (#1439 S11).
 *
 * Deposit now, balance on a production/delivery event — both rails work this
 * way. Stripe's docs point at charging a saved payment method later rather
 * than holding an authorisation, since a card hold lasts 7 days and a
 * made-to-order lead time does not.
 */
export type AdminPaymentSchedule = {
  id: string
  cart_id?: string | null
  order_id?: string | null
  currency_code: string
  total_due: number
  deposit_pct: number
  deposit_amount: number
  /** `waived` is a partner taking a buyer on account — not money received. */
  deposit_status: "pending" | "paid" | "failed" | "waived"
  deposit_paid_at?: string | null
  balance_amount: number
  /** `not_due` until the goods exist; raising it earlier demands money for nothing. */
  balance_status: "not_due" | "due" | "paid" | "failed" | "waived"
  balance_paid_at?: string | null
  balance_due_at?: string | null
  rail: "payu" | "stripe" | "manual"
}

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
  /** `manual` when a person named the freight, `estimated` when it was rated. */
  quoted_freight_source?: "estimated" | "manual" | null
  quoted_freight_basis?: string | null
  /** #1447 — the DDP undertaking and the duty figure frozen behind it. */
  duties_prepaid?: boolean | null
  quoted_duty_total?: number | null
  quoted_import_tax_total?: number | null
  quoted_ddp_fee_total?: number | null
  quoted_duty_rate?: number | null
  quoted_import_tax_rate?: number | null
  quoted_duty_basis?: string | null
  status?: "active" | "revoked" | "superseded"
  expires_at?: string | null
  /**
   * Terms and acceptance (#1439 S11). `deposit_pct` is null when nobody named
   * terms, which is NOT the same as 0. `payment_schedule` arrives on the
   * detail read only, and only once accepted.
   */
  deposit_pct?: number | null
  accepted_cart_id?: string | null
  accepted_at?: string | null
  payment_schedule?: AdminPaymentSchedule | null
  view_count?: number
  last_viewed_at?: string | null
  created_at?: string
}

/**
 * 🔑 `count` is the number of MATCHING rows, not the length of `quotes`.
 * Until #1441 the route returned the whole table and reported its length, so
 * anything paging on this was paging over a lie. `limit`/`offset` echo what
 * the server actually applied after clamping.
 */
export type AdminQuoteListResponse = {
  quotes: AdminQuote[]
  count: number
  limit?: number
  offset?: number
}

export type AdminQuoteListQuery = {
  partner_id?: string
  status?: string
  /** Free text over buyer email, company and recipient name. */
  q?: string
  limit?: number
  offset?: number
  /** `field:ASC|DESC`. An unknown field falls back to `created_at:DESC`. */
  order?: string
}

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
  /**
   * The deposit share, 0-100 (#1439 S11). `null` means no terms were named and
   * the backend applies its default; `0` means take nothing up front.
   */
  deposit_pct?: number | null
  /** Freight named by hand, in the quote currency, and where it came from. */
  freight_override_amount?: number | null
  freight_basis?: string | null
  /** DDP (#1447): the undertaking, the amount absorbed, and how it was reached. */
  duties_prepaid?: boolean
  duty_rate_percent?: number | null
  import_tax_rate_percent?: number | null
  duty_total?: number | null
  import_tax_total?: number | null
  ddp_fee_total?: number | null
  duty_basis?: string | null
}

/**
 * 🔴 `token` arrives ONCE, on the mint response, and is never retrievable —
 * only its sha256 is stored. Nothing in this file may cache it, and no list
 * query can reconstruct it. The UI must present it as a copy-now-or-lose-it
 * value, exactly as the partner surface already does.
 */
export type AdminMintQuoteResponse = { quote: AdminQuote; token: string }

export const useQuotes = (
  query?: AdminQuoteListQuery,
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

/** One named reason a basket cannot be quoted (#1445). */
export type QuoteReadinessIssue = {
  code: string
  severity: "blocking" | "warning"
  /** Written for the operator looking at the wizard, not for a log. */
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

export type AdminQuoteReadinessPayload = {
  partner_id: string
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
 * 🔴 On THIS surface the catalogue check is the one that matters. An admin
 * picks the partner from one dropdown and the variants from another, so the
 * two can disagree with a single mis-click — and nothing downstream catches it:
 * the price list is created successfully, its rule assertion passes, and the
 * buyer gets a working link to prices the partner never agreed to sell at.
 *
 * A mutation despite writing nothing: the input is a whole basket, so it is
 * POSTed, and it must run on demand rather than on every keystroke of a
 * quantity field. It prices every line and asks a carrier.
 */
export const useAdminQuoteReadiness = (
  options?: UseMutationOptions<
    { readiness: QuoteReadiness },
    FetchError,
    AdminQuoteReadinessPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<{ readiness: QuoteReadiness }>(
        "/admin/quotes/readiness",
        { method: "POST", body: payload }
      ),
    ...options,
  })
}
