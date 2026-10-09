import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { readOrderBalance } from "../../../../../lib/payments/describe-order-balance"
import { validatePartnerOrderOwnership } from "../../../helpers"

/**
 * GET /partners/orders/:id/balance
 *
 * The partner's view of what their buyer still owes on a deposit order — the
 * same read the admin card uses (`readOrderBalance`), so the two never
 * disagree. Only the partner who owns the order can read it.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)
  return res.json(await readOrderBalance(req.scope, orderId))
}
