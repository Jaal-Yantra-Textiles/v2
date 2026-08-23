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

/**
 * What the buyer still owes on an accepted quote (#1439 S11).
 *
 * Deposit now, balance on a production/delivery event. Both rails work this
 * way — Stripe's own docs point at charging a saved payment method later
 * rather than holding an authorisation, since a card hold lasts 7 days and a
 * made-to-order lead time does not.
 */
export type PartnerQuotePaymentSchedule = {
  id: string
  cart_id?: string | null
  order_id?: string | null
  currency_code: string
  total_due: number
  deposit_pct: number
  deposit_amount: number
  /** `waived` is a partner taking a trusted buyer on account — not money received. */
  deposit_status: "pending" | "paid" | "failed" | "waived"
  deposit_paid_at?: string | null
  balance_amount: number
  /** `not_due` until the goods exist; raising it earlier is a demand against nothing. */
  balance_status: "not_due" | "due" | "paid" | "failed" | "waived"
  balance_paid_at?: string | null
  balance_due_at?: string | null
  rail: "payu" | "stripe" | "manual"
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
  /** `manual` when a person named the freight, `estimated` when it was rated. */
  quoted_freight_source?: "estimated" | "manual" | null
  quoted_freight_basis?: string | null
  quoted_landed_total?: number | null
  quoted_weight_grams?: number | null
  quoted_at?: string | null

  status: "active" | "revoked" | "superseded"
  expires_at?: string | null

  /**
   * Acceptance and terms (#1439 S11).
   *
   * `accepted_cart_id` is the acceptance itself, and the idempotency key
   * behind it — a buyer who double-submits gets the same cart, not a second
   * one priced against the same price list. `deposit_pct` is null when the
   * partner named no terms, which is NOT the same as 0.
   */
  deposit_pct?: number | null
  accepted_cart_id?: string | null
  accepted_at?: string | null
  /** Present only on the detail read, and only once accepted. */
  payment_schedule?: PartnerQuotePaymentSchedule | null

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
/** What the buyer link's delivery actually did (#1420). */
export type QuoteEmailDelivery = {
  sent: boolean
  to: string | null
  buyer_url: string | null
  /** Plain words, meant to be shown to the partner. Null on success. */
  reason: string | null
}

export type MintPartnerQuoteResponse = {
  quote: PartnerQuote
  token: string
  /**
   * Composed SERVER-side (#1420). Do not rebuild this in the UI: the rule
   * includes refusing an unverified custom domain, and the two panels that
   * each had their own copy of it disagreed with each other.
   */
  buyer_url: string | null
  email: QuoteEmailDelivery
}

export type MintPartnerQuotePayload = {
  buyer_email: string
  recipient_name?: string | null
  recipient_company?: string | null
  partner_note?: string | null
  lines: {
    variant_id: string
    /**
     * The design this line was picked as (#1486). Sent ALONGSIDE the variant,
     * not instead of it: the wizard already knows which variant the design
     * resolves to, and sending both is what lets a design sold as several
     * variants be quoted at all.
     */
    design_id?: string | null
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
  /**
   * The deposit share, 0-100 (#1439 S11). `null` means no terms were named and
   * the backend falls through to its default; `0` means take nothing up front.
   */
  deposit_pct?: number | null
  /**
   * Freight named by hand, in the quote currency, and where it came from
   * (#1439 S12). Used when no carrier will rate the lane, or when the stored
   * tier is wrong for this weight — it is flat at any weight today.
   */
  freight_override_amount?: number | null
  freight_basis?: string | null
  /**
   * DDP (#1447): we pay the destination duty, and the amount we are absorbing
   * plus how it was reached. The backend refuses the flag without the pair.
   */
  duties_prepaid?: boolean
  duty_rate_percent?: number | null
  import_tax_rate_percent?: number | null
  duty_total?: number | null
  import_tax_total?: number | null
  ddp_fee_total?: number | null
  duty_basis?: string | null
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

/** One row of the design picker (#1486). */
export type QuotableDesign = {
  id: string
  name: string | null
  thumbnail_url: string | null
  product_type: string | null
  status: string | null
  /** True when exactly one variant backs it, so a line can be built. */
  quotable: boolean
  variant_id: string | null
  product_id: string | null
  candidates: Array<{
    variant_id: string
    title: string | null
    sku: string | null
    product_id: string | null
    product_title: string | null
  }>
  /** Why it cannot be quoted, in words for a partner. Null when `quotable`. */
  reason: string | null
}

export type QuotableDesignsResponse = {
  designs: QuotableDesign[]
  count: number
  limit: number
  offset: number
}

/**
 * The designs this partner can quote (#1486).
 *
 * 🔑 Returns the UNQUOTABLE ones too, with their reason. The picker greys them
 * rather than hiding them — a partner who knows a design exists and cannot find
 * it has no way to learn that the fix is "create a product from it first".
 */
export const usePartnerQuotableDesigns = (
  params: { q?: string; limit?: number; offset?: number } = {},
  options?: Omit<
    UseQueryOptions<
      QuotableDesignsResponse,
      FetchError,
      QuotableDesignsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: [...partnerQuotesQueryKeys.all, "quotable-designs", params],
    queryFn: async () =>
      await sdk.client.fetch<QuotableDesignsResponse>(
        "/partners/quotes/designs",
        { method: "GET", query: params as any }
      ),
    ...options,
  })

  return {
    designs: data?.designs ?? [],
    count: data?.count ?? 0,
    ...rest,
  }
}
