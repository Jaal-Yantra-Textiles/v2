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
  /**
   * 🔑 `validatedBody`, populated by `validateAndTransformBody` in
   * `middlewares.ts` — and by nothing else. Both routes were registered
   * without it, so this read was always undefined, the client's JSON sat in
   * `req.body` unread, and every pick answered "currency_code is required".
   * The schema now enforces the requirement, so there is no hand-rolled check
   * here to drift from it.
   */
  const body = req.validatedBody as { currency_code: string; markup_percent?: number }

  const { result } = await ensureDesignQuoteVariantWorkflow(req.scope).run({
    input: {
      design_id: designId,
      currency_code: body.currency_code,
      markup_percent: body.markup_percent,
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
