import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../modules/partner-quote"
import { loadScheduleForQuote } from "../../../../modules/payment_schedule/lib/for-quote"

/**
 * One quote, with its lines and its activity (#1389 S5).
 *
 * 🔴 There is no token here and there never can be — only its sha256 is stored,
 * so no read can reconstruct a working link. A detail page must say that plainly
 * rather than offering a button that cannot work; the only way to get a fresh
 * link is to mint again.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const quotes = await service.listPartnerQuotes({ id: req.params.id })
  const quote = quotes?.[0]
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  const [lines, events, payment_schedule] = await Promise.all([
    service.listPartnerQuoteLines({ quote_id: quote.id }),
    service.listEvents(quote.id),
    // What the buyer still owes, once they have accepted (#1439 S11). Null on
    // every quote nobody has accepted, which is most of them.
    loadScheduleForQuote(req.scope, quote),
  ])

  res.json({ quote: { ...quote, lines, events, payment_schedule } })
}
