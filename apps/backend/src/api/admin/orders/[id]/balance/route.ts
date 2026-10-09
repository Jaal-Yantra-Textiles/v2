import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  describeOrderBalance,
  readOrderBalance,
} from "../../../../../lib/payments/describe-order-balance"
import { requestOrderBalanceWorkflow } from "../../../../../workflows/payments/request-order-balance"

/**
 * The order's outstanding balance — read it, and raise it.
 *
 * GET  /admin/orders/:id/balance   — what is owed, and whether it can be raised
 * POST /admin/orders/:id/balance   — raise it and mint the buyer's link
 *
 * The partner route (`/partners/orders/:id/request-balance`) is the one an
 * operator normally uses, because the makers know when the goods exist. This is
 * the same workflow for admin — for an order no partner is working, or when a
 * partner asks for it to be done on their behalf.
 *
 * GET reconciles first: the payment module emits no events, so an admin opening
 * the order is another reliable moment to notice that money already landed.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  return res.json(await readOrderBalance(req.scope, req.params.id))
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const body = (req.validatedBody ?? req.body ?? {}) as { confirm?: boolean }

  /**
   * 🔴 Raising a balance asks a real buyer for money. It is not undoable by the
   * caller — a link goes out and a charge is created — so it needs the same
   * deliberate second step every sensitive admin action here needs.
   */
  if (!body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Raising the balance charges a buyer. Pass confirm:true once you have checked the amount on the order."
    )
  }

  const { result } = await requestOrderBalanceWorkflow(req.scope).run({
    input: { order_id: orderId, requested_by: "admin" },
  })

  const out = result as any

  return res.json({
    raised: Boolean(out.raised),
    pay_url: out.pay_url ?? null,
    payment_collection_id: out.payment_collection_id ?? null,
    ...(await describeOrderBalance(req.scope, orderId)),
  })
}
