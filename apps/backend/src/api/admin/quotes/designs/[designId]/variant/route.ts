import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { ensureDesignQuoteVariantWorkflow } from "../../../../../../workflows/partner-quote/ensure-design-quote-variant"

/**
 * The admin twin of `/partners/quotes/designs/:designId/variant`.
 *
 * 🔑 Unscoped by partner, like the admin mint and the admin design picker: an
 * admin legitimately quotes a design the producing partner does not own. The
 * guard that matters on the admin surface is the catalogue assertion at mint
 * time, which checks the resolved variant is in that partner's sales channel —
 * and it applies to a minted variant exactly as it does to an existing one.
 *
 * See the partner route for why minting happens on PICK and why it has to be
 * idempotent.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
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
      partner_id: null,
    },
  })

  // 422 rather than 200-with-nulls — see the partner route.
  if (!(result as any)?.variant_id) {
    return res.status(422).json({
      error: (result as any)?.reason ?? "This design cannot be quoted yet.",
      design: result,
    })
  }

  res.json({ design: result })
}
