import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../modules/partner-quote"
import { withEffectiveStatus } from "../../../../modules/partner-quote/lib/token"
import { loadScheduleForQuote } from "../../../../modules/payment_schedule/lib/for-quote"
import { getPartnerFromAuthContext } from "../../helpers"

/**
 * One of the calling partner's quotes, with lines and activity (#1389 S5).
 *
 * 🔑 Ownership is checked against the AUTH CONTEXT, not taken from the URL. The
 * id in the path names a row that may belong to anyone — validating only that
 * it exists is the #1404 defect, where partner routes trusted an id they were
 * handed. A quote belonging to another partner is a 404, not a 403: a partner
 * has no business learning that someone else's quote id is real.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)
  const quotes = await service.listPartnerQuotes({
    id: req.params.id,
    partner_id: partner.id,
  })

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

  // #1510 — `status` is the stored fact; `status_effective` is what it means
  // today. The detail page reads the same word as the list it was opened from.
  res.json({
    quote: withEffectiveStatus(
      { ...quote, lines, events, payment_schedule },
      new Date()
    ),
  })
}
