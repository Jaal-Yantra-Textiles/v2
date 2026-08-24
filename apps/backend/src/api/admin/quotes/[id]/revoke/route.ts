import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { revokeQuote } from "../../../../../modules/partner-quote/lib/revoke-quote"

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

  res.json(result)
}
