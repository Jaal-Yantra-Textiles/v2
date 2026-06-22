/**
 * @file Partner API route for a single order's partner fee (commission).
 * @description Mirrors `GET /admin/orders/:id/partner-fee`, scoped to the
 * authenticated partner so they can see the platform commission deducted on
 * each order they fulfil (#623, follow-up to #336). Ownership is asserted first
 * via `validatePartnerOrderOwnership` — a partner can never read a fee for an
 * order that isn't theirs (no cross-tenant leak). Read-only.
 * @module API/Partners/Orders/PartnerFee
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validatePartnerOrderOwnership } from "../../../helpers"
import { PARTNER_BILLING_MODULE } from "../../../../../modules/partner_billing"
import { describeFee } from "../../../../../modules/partner_billing/lib/describe-fee"

/**
 * GET /partners/orders/:id/partner-fee
 * → { order_id, fee: PartnerFee | null, display: DescribedFee | null }
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  // Throws (403/404) if the authenticated partner does not own this order.
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const billing: any = req.scope.resolve(PARTNER_BILLING_MODULE)
  const fee = await billing.findFeeForOrder(req.params.id)

  return res.status(200).json({
    order_id: req.params.id,
    fee: fee || null,
    display: describeFee(fee),
  })
}
