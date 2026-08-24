import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../modules/partner-quote"
import { revokeQuote } from "../../../../../modules/partner-quote/lib/revoke-quote"
import { getPartnerFromAuthContext } from "../../../helpers"

/**
 * A partner withdraws their own quote (#1517).
 *
 * ## Why this exists
 *
 * `/admin/quotes/:id/revoke` has existed since #1389 S5; this surface had no
 * equivalent, so a partner who mis-quoted — wrong price, wrong buyer, wrong
 * lane — could only ask an operator, and the buyer's link stayed live and
 * acceptable until it expired. Worse, `mint_quote`'s own guidance told the
 * assistant to "revoke the old quote first": an instruction naming an action
 * no tool on this surface could perform (#1394's shape).
 *
 * Re-minting is not a substitute. It emails the buyer a NEW number they did
 * not ask for and freezes a fresh price list; "I mis-quoted, please ignore
 * that" had no expression here except silence until expiry.
 *
 * 🔑 Ownership is checked against the AUTH CONTEXT, not taken from the URL —
 * the id in the path names a row that may belong to anyone, and validating
 * only that it exists is the #1404 defect. Another partner's quote is a 404,
 * not a 403: a partner has no business learning that someone else's quote id
 * is real, and this route is destructive, so the guard is the only thing
 * standing between a stranger's id and their buyer's prices.
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

  /**
   * 🔴 An accepted quote is not the partner's to withdraw.
   *
   * Acceptance is `accepted_at` plus an `accepted_cart_id` — a real cart the
   * buyer built at these prices, possibly with a deposit already paid against
   * it. Revoking deletes the price list, so the prices in that cart would move
   * under a buyer who had already committed, and nothing would tell them. The
   * admin route deliberately keeps that power, because unwinding a live deal
   * is an operator's decision with a conversation attached; the partner
   * surface refuses and says who can.
   *
   * NOT_ALLOWED, not CONFLICT: the framework's error handler REPLACES a
   * CONFLICT message with a generic "you may retry with an Idempotency-Key"
   * line, so the partner would be told to retry the one thing that cannot
   * work, and never learn why.
   */
  if (quote.accepted_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This quote has already been accepted by the buyer, so it cannot be revoked here — the accepted cart is priced from it. Ask an operator to unwind the deal."
    )
  }

  const result = await revokeQuote(req.scope, quote, {
    type: "partner",
    id: req.auth_context?.actor_id ?? null,
  })

  res.json(result)
}
