import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_QUOTE_MODULE } from "../../../../../../modules/partner-quote"
import { hashQuoteToken } from "../../../../../../modules/partner-quote/lib/token"
import { assertQuoteVisibleToCaller } from "../../../../../../modules/partner-quote/lib/quote-tenant-guard"
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

  /**
   * 🔴 The tenant boundary matters MORE here than on the read (#1439 S15).
   * This route builds a real cart bound to the quote's own customer and its
   * minted price list — so without the check, the wrong storefront could start
   * an order against another partner's frozen prices.
   */
  await assertQuoteVisibleToCaller(req, quote)

  const body = (req.validatedBody ?? req.body ?? {}) as Record<string, any>

  const { result } = await acceptQuoteWorkflow(req.scope).run({
    input: {
      // From the token, never from the body: a caller who could name the quote
      // could accept someone else's.
      quote_id: quote.id,
      shipping_address: body.shipping_address ?? null,
      /**
       * The basket as dialled on the page (#1439 S13).
       *
       * Normalised HERE rather than trusted: the workflow refuses a variant
       * that is not already on the quote, but a malformed array should not
       * reach it as an exception from deep inside a step. Shape only — every
       * decision about what a dial is ALLOWED to do stays in the workflow,
       * where the quote's own lines are in hand.
       */
      dialled_lines: Array.isArray(body.lines)
        ? body.lines
            .filter((l: any) => l && typeof l.variant_id === "string")
            .map((l: any) => ({
              variant_id: String(l.variant_id),
              quantity: Number(l.quantity),
            }))
        : null,
      // Deliberately NOT exposed to the buyer. A tax divergence means the cart
      // would charge something other than what this buyer was promised, and the
      // person who gets to say "take it anyway" is the partner, not the person
      // being overcharged.
      allow_tax_divergence: false,
    },
  })

  res.status(201).json({ acceptance: result })
}
