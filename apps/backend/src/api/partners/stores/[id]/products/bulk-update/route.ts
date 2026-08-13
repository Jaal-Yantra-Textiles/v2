import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { validatePartnerStoreAccess } from "../../../../helpers"
import { bulkUpdateProducts } from "../../../../../../workflows/products/bulk-update-products"
import type { BulkUpdateProductsReq } from "../../../../../admin/products/bulk-update/validators"

/**
 * POST /partners/stores/:id/products/bulk-update
 *
 * Partner mirror of `POST /admin/products/bulk-update`.
 *
 * Two scoping rails, and both are load-bearing. Passing the store check is not
 * enough on its own — the ids and selectors in the body are arbitrary:
 *
 *  - `salesChannelId` confines every selector AND every explicit product id to
 *    this store's own catalogue. Out-of-scope ids come back as per-row errors
 *    rather than failing the batch, and a store with no channel resolves to
 *    nothing rather than defaulting open.
 *  - `allowedLocationIds` confines stock writes to the store's own location. A
 *    partner naming someone else's location has it dropped with a warning,
 *    never honoured.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = (req as any).validatedBody as BulkUpdateProductsReq

  const result = await bulkUpdateProducts(req.scope, body, {
    salesChannelId: store.default_sales_channel_id,
    allowedLocationIds: store.default_location_id
      ? [store.default_location_id]
      : [],
  })

  res.status(200).json(result)
}
