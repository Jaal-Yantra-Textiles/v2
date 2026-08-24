import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { adjustQuote } from "../../../../../modules/partner-quote/lib/adjust-quote"
import { withEffectiveStatus } from "../../../../../modules/partner-quote/lib/token"
import { getPartnerFromAuthContext } from "../../../helpers"

/**
 * A partner corrects their own quote, in place, before the buyer accepts.
 *
 * ## Why this is not "revoke and re-mint"
 *
 * Re-minting emails the buyer a NEW quote number for what is, from their side,
 * a correction to the document they are already reading — and it mints a fresh
 * price list and supersedes the old one, which is a great deal of machinery to
 * move a shipping figure. The common case is exactly that: a lane no carrier
 * would rate falls through to a flat tier nobody chose.
 *
 * The link, the quote number and the frozen prices all survive an adjustment.
 *
 * 🔑 Ownership is checked against the AUTH CONTEXT, not taken from the URL —
 * the id in the path names a row that may belong to anyone, and validating only
 * that it exists is the #1404 defect. Another partner's quote is a 404, not a
 * 403: a partner has no business learning that someone else's quote id is real.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
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

  const result = await adjustQuote(
    req.scope,
    quote,
    req.validatedBody as any,
    { type: "partner", id: req.auth_context?.actor_id ?? null }
  )

  res.json({
    quote: withEffectiveStatus(result.quote, new Date()),
    changes: result.changes,
    /**
     * Whether the buyer should be told. The caller sends the mail — this route
     * decides only whether it is warranted, so both surfaces agree on when.
     */
    notify_buyer: result.notify,
  })
}
