import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { validatePartnerStoreAccess } from "../../../../../helpers"
import { scanMissingHsCodes } from "../../../../../../../workflows/customs/hs-codes"

/**
 * GET /partners/stores/:id/customs/hs-codes/missing
 *
 * Partner mirror of `GET /admin/customs/hs-codes/missing`, scoped to the
 * store's own sales channel so a partner can only ever see gaps in their own
 * catalogue. Same scan function as admin — one definition, two surfaces (#843).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const result = await scanMissingHsCodes(req.scope, {
    // Scoping is NOT optional here — without it a partner would scan the whole
    // platform catalogue.
    salesChannelId: store.default_sales_channel_id,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  })

  res.status(200).json(result)
}
