import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../../../../modules/payment_schedule"
import { planBalanceCollection } from "../../../../../lib/payments/balance-collection"
import { reconcileBalanceForSchedule } from "../../../../../lib/payments/reconcile-balance"
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
const describe = async (req: MedusaRequest, orderId: string) => {
  const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const schedule = await schedules.findByOrderId(orderId).catch(() => null)

  if (!schedule) {
    return {
      has_schedule: false,
      order_id: orderId,
      message:
        "This order has no payment schedule — it was paid in full, so there is no balance to collect.",
    }
  }

  const plan = planBalanceCollection(schedule)

  return {
    has_schedule: true,
    order_id: orderId,
    payment_schedule_id: schedule.id,
    currency_code: schedule.currency_code ?? null,
    total_due: Number(schedule.total_due) || null,
    deposit_amount: Number(schedule.deposit_amount) || null,
    deposit_status: schedule.deposit_status ?? null,
    balance_amount: Number(schedule.balance_amount) || null,
    balance_status: schedule.balance_status ?? null,
    balance_due_at: schedule.balance_due_at ?? null,
    /** The link already sent to the buyer, when one has been minted. */
    balance_link: schedule.balance_link_ref ?? null,
    rail: schedule.rail ?? null,
    can_raise: plan.collectable,
    /** Why it cannot be raised, when it cannot. Always populated on a refusal. */
    reason: plan.reason,
    code: plan.collectable ? null : plan.code,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id

  // Best-effort: an admin opening the order should see money that has landed
  // since the last look, but a reconcile failure must not blank the widget.
  try {
    const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByOrderId(orderId).catch(() => null)
    if (schedule?.balance_status === "due") {
      await reconcileBalanceForSchedule(req.scope, schedule.id)
    }
  } catch {
    /* fall through and describe whatever is stored */
  }

  return res.json(await describe(req, orderId))
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
    ...(await describe(req, orderId)),
  })
}
