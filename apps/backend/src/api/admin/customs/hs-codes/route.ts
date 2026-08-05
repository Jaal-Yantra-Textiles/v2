import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { applyHsCodes } from "../../../../workflows/customs/hs-codes"
import type { BulkHsCodesReq } from "./validators"

/**
 * POST /admin/customs/hs-codes
 *
 * Bulk-assign HS/HSN customs codes across the catalogue. Each assignment names
 * the level it writes at (`variant` | `inventory_item` | `product`) — see
 * `hs-code-resolution` for which is correct when.
 *
 * Responds 200 with a PER-ROW outcome even when some rows failed: a bad id in a
 * hundred-row batch must not discard the ninety-nine good writes. Check
 * `errors` / `results` rather than the status code to know what landed.
 *
 * Mirrored by POST /partners/stores/:id/customs/hs-codes.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody as BulkHsCodesReq

  const result = await applyHsCodes(req.scope, body.assignments)

  res.status(200).json(result)
}
