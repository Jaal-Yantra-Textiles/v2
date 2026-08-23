import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../../modules/partner-quote"
import { hashQuoteToken } from "../../../../../../modules/partner-quote/lib/token"
import { acceptQuoteWorkflow } from "../../../../../../workflows/partner-quote/accept-quote"

/**
 * The buyer accepts (#1439 S11).
 *
 * POST /store/b2b/quotes/:token/accept
 *
 * Unauthenticated, like the page it sits under: the token IS the credential.
 * That is the whole premise of the feature — a procurement contact should not
 * have to create an account before they can act on a price.
 *
 * 🔑 The token does not merely admit the caller, it **establishes who they
 * are**. The quote carries the customer it was priced for, and the workflow
 * binds the cart to that customer server-side. Nothing the caller sends can
 * change whose prices apply — which matters because the minted price list is
 * ruled on that customer's group, and a cart bound to anyone else prices every
 * line at base.
 *
 * An unknown token and a revoked one are both 404, so a prober cannot tell them
 * apart — same rule as the GET beside it.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PARTNER_QUOTE_MODULE)

  const quote = await service.findByTokenHash(hashQuoteToken(req.params.token))
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
  }

  const body = (req.validatedBody ?? req.body ?? {}) as Record<string, any>

  const { result } = await acceptQuoteWorkflow(req.scope).run({
    input: {
      // From the token, never from the body: a caller who could name the quote
      // could accept someone else's.
      quote_id: quote.id,
      shipping_address: body.shipping_address ?? null,
      // Deliberately NOT exposed to the buyer. A tax divergence means the cart
      // would charge something other than what this buyer was promised, and the
      // person who gets to say "take it anyway" is the partner, not the person
      // being overcharged.
      allow_tax_divergence: false,
    },
  })

  res.status(201).json({ acceptance: result })
}
