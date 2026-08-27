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

  /** The STORED column. `expired` is never one of its values — see below. */
  status: "active" | "revoked" | "superseded"
  /**
   * What `status` means today (#1510). Computed server-side from `status` and
   * `expires_at` by the same helper the buyer's quote page uses, so an expired
   * quote stops reading `active` on every screen that shows the word.
   */
  status_effective?: "active" | "expired" | "revoked" | "superseded"
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
  /** The buyer's stated registration. Recorded on the document, never verified. */
  buyer_tax_id?: string | null
  buyer_tax_id_type?: string | null
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
    onSuccess: async (data, variables, _mutateResult, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerQuotesQueryKeys.lists(),
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
  /**
   * True when nothing backs it YET — a custom design whose production run is
   * in the future. Picking it mints a made-to-order variant priced from what
   * comparable work has cost. Not a promise that it can be priced.
   */
  made_to_order: boolean
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
/**
 * Mint the made-to-order variant a custom design will be quoted through.
 *
 * A design whose production run is in the FUTURE has no product behind it, so
 * there is no variant for the wizard's basket to hold — the basket is
 * "products → variants → quantities" all the way down to the accepted cart.
 * This creates one, priced from what comparable work has cost, and returns it
 * so the design can be picked like any other.
 *
 * 🔑 Idempotent server-side: a design that already resolves to one variant
 * returns that variant and creates nothing. The picker is a list a partner can
 * click twice.
 *
 * ⚠️ It answers **422** when the design cannot be priced — that is a refusal
 * to render, not an error to swallow. The body carries the estimator's own
 * words, which name what is missing.
 */
export const usePartnerMintDesignVariant = (
  options?: UseMutationOptions<
    { design: MintedDesignVariant },
    FetchError,
    { design_id: string; currency_code: string }
  >
) => {
  return useMutation({
    mutationFn: async (payload: { design_id: string; currency_code: string }) =>
      await sdk.client.fetch<{ design: MintedDesignVariant }>(
        `/partners/quotes/designs/${payload.design_id}/variant`,
        { method: "POST", body: { currency_code: payload.currency_code } }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      // The design now resolves to a variant, so the picker's rows are stale.
      queryClient.invalidateQueries({
        queryKey: [...partnerQuotesQueryKeys.all, "quotable-designs"],
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type MintedDesignVariant = {
  design_id: string
  variant_id: string | null
  product_id: string | null
  minted: boolean
  unit_price: number | null
  confidence: string | null
  basis: string | null
  reason: string | null
}

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

/** What the revoke route answers with. */
export type RevokePartnerQuoteResponse = {
  quote: PartnerQuote
  /** Whether the minted price list was actually deleted, for the toast. */
  price_list_deleted?: boolean
}

/**
 * A partner withdraws their own quote (#1517).
 *
 * 🔴 DESTRUCTIVE. It deletes the price list behind the quote, so the buyer
 * loses the quoted prices in any cart they have built as well as the link.
 * The caller must put it behind a confirm — a one-click revoke in a row menu is
 * how that gets done by accident.
 *
 * Invalidates the DETAIL as well as the list: the page the partner is standing
 * on is the one whose badge has just changed, and leaving it stale shows
 * "Active" beside a toast that says it was revoked.
 */
export const useRevokePartnerQuote = (
  id: string,
  options?: UseMutationOptions<RevokePartnerQuoteResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      await sdk.client.fetch<RevokePartnerQuoteResponse>(
        `/partners/quotes/${id}/revoke`,
        { method: "POST" }
      ),
    // Forwarded by spread rather than by naming three params: react-query's
    // `onSuccess` takes four, and naming a subset is a type error the rest of
    // this file already carries. Spreading passes whatever arity it has.
    onSuccess: async (...args) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: partnerQuotesQueryKeys.lists(),
        }),
        queryClient.invalidateQueries({
          queryKey: partnerQuotesQueryKeys.detail(id),
        }),
      ])
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}
