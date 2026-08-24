import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { adjustQuote } from "../../../../../modules/partner-quote/lib/adjust-quote"
import { withEffectiveStatus } from "../../../../../modules/partner-quote/lib/token"

/**
 * An admin corrects any quote, in place, before the buyer accepts.
 *
 * The same capability the partner has, reached differently: an admin may touch
 * any quote, so there is no ownership scoping on the lookup. That is the whole
 * difference between the two surfaces — the refusals themselves live in
 * `adjustQuote` so the two cannot drift.
 *
 * 🔴 An admin gets NO override on the accepted-quote refusal, unlike revoke.
 * Revoking a live deal is an operator's decision with a conversation attached;
 * silently re-pricing one the buyer has already committed to is not a decision
 * anybody should be able to make through an API.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const quotes = await service.listPartnerQuotes({ id: req.params.id })
  const quote = quotes?.[0]
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  const result = await adjustQuote(
    req.scope,
    quote,
    req.validatedBody as any,
    { type: "admin", id: (req as any).auth_context?.actor_id ?? null }
  )

  res.json({
    quote: withEffectiveStatus(result.quote, new Date()),
    changes: result.changes,
    notify_buyer: result.notify,
  })
}
