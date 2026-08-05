import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { validatePartnerStoreAccess } from "../../../../helpers"
import {
  applyHsCodes,
  partitionAssignmentsByStore,
} from "../../../../../../workflows/customs/hs-codes"
import type { BulkHsCodesReq } from "../../../../../admin/customs/hs-codes/validators"

/**
 * POST /partners/stores/:id/customs/hs-codes
 *
 * Partner mirror of `POST /admin/customs/hs-codes`.
 *
 * Store access is checked first, then EVERY assignment is checked against the
 * store's own catalogue. Passing the store check is not enough on its own: the
 * ids in the body are arbitrary and unscoped, so without the second pass a
 * partner could rewrite another seller's customs declaration. Out-of-scope rows
 * come back as per-row errors rather than failing the whole batch.
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

  const body = (req as any).validatedBody as BulkHsCodesReq

  const { owned, foreign } = await partitionAssignmentsByStore(
    req.scope,
    store.default_sales_channel_id,
    body.assignments
  )

  const result = await applyHsCodes(req.scope, owned)

  const rejected = foreign.map((a) => ({
    level: a.level,
    id: a.id,
    status: "error" as const,
    reason: "Not part of your store's catalogue.",
  }))

  res.status(200).json({
    ...result,
    errors: result.errors + rejected.length,
    results: [...result.results, ...rejected],
  })
}
