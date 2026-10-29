import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { revokeQuote } from "../../../../../modules/partner-quote/lib/revoke-quote"
import { notifyQuoteRevoked } from "../../../../../modules/partner-quote/lib/notify-quote-revoked"

/**
 * Revoke a quote (#1389 S5).
 *
 * An admin may revoke any quote — they have no partner of their own, so there
 * is nothing to scope the lookup to. The partner twin at
 * `/partners/quotes/:id/revoke` (#1517) scopes by the auth context instead;
 * everything after the lookup is shared, in `lib/revoke-quote.ts`, including
 * the reason the price list must die before the status is written.
 *
 * The buyer's page 404s either way: an unknown token and a revoked one are
 * deliberately indistinguishable to a prober.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const quotes = await service.listPartnerQuotes({ id: req.params.id })
  const quote = quotes?.[0]
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  const result = await revokeQuote(req.scope, quote, {
    type: "admin",
    id: (req as any).auth_context?.actor_id ?? null,
  })

  // The buyer is told unless the caller sends notify_buyer: false. Their
  // link now 404s, and without this they find out only by clicking it.
  const body = (req.body ?? {}) as { notify_buyer?: unknown; buyer_message?: unknown }
  const buyer_notification = await notifyQuoteRevoked(req.scope, {
    quote,
    alreadyRevoked: (result as any)?.already_revoked === true,
    notify: body.notify_buyer,
    buyerMessage: body.buyer_message,
  })

  res.json({ ...result, buyer_notification })
}
