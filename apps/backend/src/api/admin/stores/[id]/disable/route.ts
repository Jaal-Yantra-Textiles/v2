import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setStoreDisabled } from "../lib/set-disabled"

/**
 * POST /admin/stores/:id/disable
 *
 * Disable a store's storefront by disabling its default sales channel
 * (`is_disabled=true`). Reversible — see `POST /admin/stores/:id/enable`.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const result = await setStoreDisabled(req.scope, req.params.id, true)
  res.status(200).json(result)
}