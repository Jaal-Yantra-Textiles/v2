import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { ensureDesignQuoteVariantWorkflow } from "../../../../../../workflows/partner-quote/ensure-design-quote-variant"
import { getPartnerFromAuthContext } from "../../../../helpers"

/**
 * Make a custom design pickable, by minting the variant it will be quoted
 * through.
 *
 * ## Why the picker calls this rather than just selecting the design
 *
 * The wizard's basket is "selected products → their variants → quantities".
 * Every downstream step — the readiness preflight, the minted price list, the
 * accepted cart — is keyed on a variant. A design whose production run is in
 * the FUTURE has neither a product nor a variant, so there is nothing for the
 * basket to hold until one exists.
 *
 * Minting on PICK rather than at quote-create also puts the price in front of
 * the partner while they can still do something about it. A figure derived
 * from comparable work is a starting point they are meant to dial, and finding
 * it out at mint time is finding it out too late.
 *
 * 🔑 Idempotent. A design that already resolves to one variant returns that
 * variant and creates nothing — the picker is a list a partner can click
 * twice, and a second mint would leave the design resolving to TWO variants,
 * which makes it unquotable for the opposite reason.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no partner found" })
  }

  const designId = String(req.params.designId)
  const currencyCode = String(
    (req.validatedBody as any)?.currency_code ?? req.query.currency_code ?? ""
  )

  if (!currencyCode) {
    return res.status(400).json({
      error:
        "currency_code is required — the variant has to be listed in the currency the quote is denominated in.",
    })
  }

  const { result } = await ensureDesignQuoteVariantWorkflow(req.scope).run({
    input: {
      design_id: designId,
      currency_code: currencyCode,
      // Scoped: a partner may only quote designs they own or are assigned to.
      partner_id: partner.id,
    },
  })

  /**
   * 🔴 422, not 200-with-nulls. A design that could not be priced is a refusal
   * the picker has to render as one — answering 200 would let a caller that
   * does not check `variant_id` carry a null into the basket, and the null
   * would surface at mint time as "variant missing", which names the wrong
   * problem.
   */
  if (!(result as any)?.variant_id) {
    return res.status(422).json({
      error: (result as any)?.reason ?? "This design cannot be quoted yet.",
      design: result,
    })
  }

  res.json({ design: result })
}
