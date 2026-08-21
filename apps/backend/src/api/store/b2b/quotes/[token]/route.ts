import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

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

  const view = await buildQuoteView(req.scope, {
    quote: { ...quote, lines },
    lines: effectiveLines,
    destination_country_code: quote.destination_country_code,
    destination_postal_code: quote.destination_postal_code,
    currency_code: quote.currency_code,
    region_id: quote.region_id,
    store: { id: quote.store_id ?? undefined },
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
    now: new Date(),
  })

  // Fire-and-forget by contract: view tracking has no business turning a
  // buyer's quote page into a 500.
  service.recordView(quote.id, new Date()).catch(() => {})

  res.json({ quote: view })
}
