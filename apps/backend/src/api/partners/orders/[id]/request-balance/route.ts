import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { requestOrderBalanceWorkflow } from "../../../../../workflows/payments/request-order-balance"
import { validatePartnerOrderOwnership } from "../../../helpers"

/**
 * POST /partners/orders/:id/request-balance
 *
 * The activation. A partner working this order says the goods are made and
 * moving, which is what makes the remaining balance payable — and gets back a
 * link to send the buyer.
 *
 * ## Why a partner presses this and a clock does not
 *
 * The balance becomes payable when the goods exist, and the people who know
 * that are the makers. A timer would ask a buyer for money against goods
 * nobody had started. Several partners may be realising one order; any of them
 * may raise it, and pressing twice is harmless — the workflow reuses the
 * existing balance collection and the schedule keeps its original
 * `balance_due_at` rather than resetting the clock.
 *
 * ## 🔴 Ownership is checked before anything is read
 *
 * `validatePartnerOrderOwnership` first, always: this route mints a charge
 * against a buyer, and a partner must not be able to raise money on an order
 * that is not theirs by naming its id.
 *
 * ## Refusals are answers, not errors
 *
 * An already-paid balance, an unpaid deposit or a zero balance come back 200
 * with `raised: false` and a `reason` the partner can read. A partner pressing
 * a button twice has done nothing wrong and should not meet a 500.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const orderId = req.params.id

  const { partner } = await validatePartnerOrderOwnership(
    req.auth_context,
    orderId,
    req.scope
  )

  const { result } = await requestOrderBalanceWorkflow(req.scope).run({
    input: {
      order_id: orderId,
      requested_by: partner?.id ?? null,
    },
  })

  const out = result as any
  const plan = out.plan

  return res.status(200).json({
    raised: Boolean(out.raised),
    reused: Boolean(out.reused),
    // The figure and the link the buyer will see — the two things a partner
    // needs in order to say anything useful to them.
    amount: plan?.collectable ? plan.amount : null,
    currency_code: plan?.collectable ? plan.currency_code : null,
    pay_url: out.pay_url ?? null,
    payment_collection_id: out.payment_collection_id ?? null,
    reason: plan?.reason ?? null,
    /** `already_paid` | `waived` | `deposit_unpaid` | `no_order` | `no_amount` | `no_currency` */
    code: plan?.collectable ? null : plan?.code ?? null,
  })
}
