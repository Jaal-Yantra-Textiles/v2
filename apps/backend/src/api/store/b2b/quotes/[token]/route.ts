import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { buildQuoteView } from "../../../../../modules/partner-quote/lib/build-quote-view"
import { composeQuoteAcceptance } from "../../../../../modules/partner-quote/lib/quote-acceptance-view"
import { effectiveQuoteLines } from "../../../../../modules/partner-quote/lib/effective-quote-lines"
import { resolveQuoteParties } from "../../../../../modules/partner-quote/lib/quote-parties"
import { assertQuoteVisibleToCaller } from "../../../../../modules/partner-quote/lib/quote-tenant-guard"
import { hashQuoteToken } from "../../../../../modules/partner-quote/lib/token"

/**
 * The buyer's quote page (#1389 S3).
 *
 * The token in the URL is the only credential — there is no login, because
 * asking a procurement contact to create an account before they can see a
 * price is the wall this whole feature exists to remove. The link is
 * deliberately MULTI-VIEW: forwarding it to procurement is the use case, not
 * an abuse of it.
 *
 * 🔑 An unknown token and a revoked one must be indistinguishable to a prober,
 * so both are 404. The row is looked up by sha256 — the raw token is never
 * stored, so a database read cannot reconstruct a working link.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const quote = await service.findByTokenHash(hashQuoteToken(req.params.token))
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  /**
   * 🔴 One partner's quote must not render on another partner's storefront
   * (#1439 S15). Reproduced: three different stores' publishable keys all
   * returned 200 for the same token, exposing the buyer, both tax
   * registrations and the negotiated prices to a competitor's shop.
   *
   * Throws the same 404 as an unknown token, so a prober learns nothing.
   */
  await assertQuoteVisibleToCaller(req, quote)

  const lines = await service.listPartnerQuoteLines({ quote_id: quote.id })

  /**
   * The buyer may move their quantities; absent that, the quoted basket stands.
   *
   * 🔑 `effectiveQuoteLines` carries `quoted_unit_weight_grams` through as the
   * line's `unit_weight_grams`. Omitting it here is what made every design-led
   * quote report itself closed — see that function's docblock.
   */
  const effectiveLines = effectiveQuoteLines(
    lines as any,
    (req.query.lines as string | undefined) ?? null
  )

  // 🔴 The store's PICKUP LOCATION, not just its id.
  //
  // `buildShippingEstimate` filters its location reads on
  // `store.default_location_id`. Passing only `{ id }` left that undefined, and
  // `filters: { id: undefined }` is NO FILTER — so this page collected manual
  // shipping options from EVERY stock location on the platform. Found live on
  // the second prod mint: the buyer was offered another partner's "European
  // Shipping", "Private" and "In Person Pickup" (for a Mumbai delivery), while
  // this store's own domestic option was missing entirely — and the page's
  // freight therefore disagreed with the freight the mint had frozen seconds
  // earlier. Cross-tenant read on a public, unauthenticated route; same shape
  // as #1397.
  //
  // The estimate now refuses a missing location outright, so this can only fail
  // loudly. Kept as a filtered read by id — never a bare list.
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = quote.store_id
    ? await query.graph({
        entity: "stores",
        fields: ["id", "default_location_id"],
        filters: { id: quote.store_id },
      })
    : { data: [] }
  const store = (stores ?? [])[0] as any

  const view = await buildQuoteView(req.scope, {
    quote: { ...quote, lines },
    lines: effectiveLines,
    destination_country_code: quote.destination_country_code,
    destination_postal_code: quote.destination_postal_code,
    currency_code: quote.currency_code,
    region_id: quote.region_id,
    store: {
      id: quote.store_id ?? undefined,
      default_location_id: store?.default_location_id ?? null,
    },
    partner_id: quote.partner_id ?? null,
    /**
     * 🔴 The buyer's group, so the LIVE half re-prices through the price list
     * minted FOR them rather than off the catalogue. Without it a quote with a
     * negotiated trade price showed its own retail number as "what it costs
     * today" and told the buyer pricing had moved — minutes after minting.
     *
     * Safe here and only here: the list exists by the time anything reads this.
     */
    customer_group_id: quote.customer_group_id ?? null,
    /**
     * #1428 — whose storefront is serving this page.
     *
     * 🔑 NOT `quote.store_id`. Both mint paths resolve the store FROM the
     * partner, so the quote can only ever answer "the partner's own" and the
     * producer credit would never render. The serving storefront is the one
     * that sent the publishable key, which is the same signal
     * `/store/partner-showcase` uses to tell one's own shop from someone
     * else's. Absent ⇒ the builder says nothing rather than guessing.
     */
    viewer_sales_channel_ids:
      (req as any).publishable_key_context?.sales_channel_ids ?? null,
    /**
     * 🔴 A hand-named freight has to be re-supplied on every read (#1439 S12).
     *
     * The LIVE half of this page re-runs the estimate. Without this, a quote
     * whose freight a person named would render its live freight from the flat
     * stored tier — so the page would show, say, 35 EUR live beside 250 EUR
     * frozen, and the quote would visibly disagree with itself. That is exactly
     * the defect S8 fixed for tax, in the same place, for the same reason.
     *
     * Read off the FROZEN row and only when the row says the freight was
     * manual, so a re-read cannot invent an override on a rated quote.
     */
    freight_override_amount:
      quote.quoted_freight_source === "manual"
        ? Number(quote.quoted_freight ?? 0) || null
        : null,
    freight_basis: quote.quoted_freight_basis ?? null,
    now: new Date(),
  })

  /**
   * Who is selling and who is buying — the document header.
   *
   * 🔴 Keyed on `origin_country_code`, the country the goods LEAVE from, never
   * on the buyer's. A seller identity resolved from the consignee put a Latvian
   * company number on an India-origin declaration (#348), and a tax rate
   * resolved from the consignee put 19% German VAT on an Indian export (#1447).
   * Same shape, twice. The view has already worked out the origin.
   */
  const parties = await resolveQuoteParties(req.scope, {
    quote,
    partner_id: quote.partner_id ?? null,
    origin_country_code: (view as any)?.origin_country_code ?? null,
  })

  // Fire-and-forget by contract: view tracking has no business turning a
  // buyer's quote page into a 500.
  service.recordView(quote.id, new Date()).catch(() => {})

  /**
   * What pressing Accept would do, and whether it can (#1439 S11).
   *
   * The GROSS total: the deposit is a share of what the cart actually charges,
   * and the cart charges tax. Live first — it is what the cart will use — and
   * the frozen figure only when the live half could not be computed.
   */
  const acceptance = composeQuoteAcceptance({
    quote,
    gross_total:
      (view as any)?.live?.gross_total ?? (view as any)?.quoted?.gross_total ?? null,
    /**
     * 🔴 The LIFECYCLE verdict, which is the one this parameter means (#1705).
     * `live_error` used to be passed here, and it is a PRICING failure — so an
     * open quote, minted an hour earlier, told its buyer it was no longer open
     * and to ask for a fresh one that would have failed the same way.
     */
    unusable_reason: (view as any)?.unusable_reason ?? null,
    pricing_error: (view as any)?.live_error ?? null,
  })

  res.json({ quote: { ...view, parties, acceptance } })
}
