/**
 * @file Admin API route for a single order's partner fee (commission).
 * @description Read-only — the platform commission accrued for ONE order (#623,
 * follow-up to #336). Surfaces the per-order fee on the admin order detail page
 * (the partner detail page already shows the aggregate ledger via
 * `/admin/partners/:id/fees`). Returns `fee: null` for a retail order that never
 * accrued a fee. Fees are accrued/reversed by the order.placed / order.canceled
 * subscribers — never mutated here.
 * @module API/Admin/Orders/PartnerFee
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { PARTNER_BILLING_MODULE } from "../../../../../modules/partner_billing"
import { describeFee } from "../../../../../modules/partner_billing/describe-fee"

/**
 * GET /admin/orders/:id/partner-fee
 * → { order_id, fee: PartnerFee | null, display: DescribedFee | null }
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const billing: any = req.scope.resolve(PARTNER_BILLING_MODULE)
  const fee = await billing.findFeeForOrder(orderId)

  return res.status(200).json({
    order_id: orderId,
    fee: fee || null,
    display: describeFee(fee),
  })
}
