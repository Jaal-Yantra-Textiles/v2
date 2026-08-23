import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { buildQuoteView } from "../../../../../modules/partner-quote/lib/build-quote-view"
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

  const lines = await service.listPartnerQuoteLines({ quote_id: quote.id })

  // The buyer may move their quantities; absent that, the quoted basket stands.
  const requested = (req.query.lines as string | undefined) ?? null
  let effectiveLines = (lines ?? []).map((l: any) => ({
    variant_id: l.variant_id,
    quantity: l.quantity,
    position: l.position,
    note: l.note,
  }))

  if (requested) {
    try {
      const dialled = JSON.parse(requested) as Array<{
        variant_id: string
        quantity: number
      }>
      const byVariant = new Map(dialled.map((d) => [d.variant_id, d.quantity]))
      effectiveLines = effectiveLines.map((l: any) => ({
        ...l,
        quantity: Number(byVariant.get(l.variant_id) ?? l.quantity),
      }))
    } catch {
      // A malformed dial is not worth a 400 — show the quoted basket instead of
      // failing a buyer's page over a query string.
    }
  }

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

  // Fire-and-forget by contract: view tracking has no business turning a
  // buyer's quote page into a 500.
  service.recordView(quote.id, new Date()).catch(() => {})

  res.json({ quote: view })
}
