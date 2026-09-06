import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setStoreDisabled } from "../lib/set-disabled"

/**
 * POST /admin/stores/:id/enable
 *
 * Re-enable a store's storefront by enabling its default sales channel
 * (`is_disabled=false`). The reverse of `POST /admin/stores/:id/disable`.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const result = await setStoreDisabled(req.scope, req.params.id, false)
  res.status(200).json(result)
}