/**
 * Pure planning for `reinstate-balance-from-credit-line` (order #176).
 *
 * A buyer owed a 50% deposit was charged in full. The admin refunded part of
 * it with the reason "Pricing Error", and Medusa recorded that as a CREDIT
 * LINE: the order total dropped to what was kept, the order read fully paid,
 * and the balance could never be raised. The intent was "deposit now, balance
 * later", not a discount.
 *
 * The fix reverses that credit line (an offsetting negative one, so the
 * history stays) and re-states the schedule as what the money says:
 *   deposit = net paid (captured - refunded), balance = total - net paid.
 */

export type ReinstateInput = {
  order: {
    id: string
    status?: string | null
    total: number
    credit_lines: Array<{ id: string; amount: number; reference?: string | null; reference_id?: string | null }>
    captured: number
    refunded: number
  }
  credit_line_id: string
  schedule: {
    id: string
    deposit_status?: string | null
    balance_status?: string | null
    total_due?: number | null
    deposit_amount?: number | null
    balance_amount?: number | null
  } | null
}

export type ReinstatePlan =
  | { ok: false; reason: string }
  | {
      ok: true
      reverse_amount: number
      total_before: number
      total_after: number
      net_paid: number
      balance: number
      schedule_update: { id: string; total_due: number; deposit_amount: number; balance_amount: number }
    }

export const REVERSAL_REFERENCE = "credit_line_reversal"
/**
 * The reversal's reference_id. NOT the original credit line's id: Medusa's
 * CREDIT_LINE_ADD handler skips an action whose reference_id equals an
 * existing credit line's id, so that silently did nothing.
 */
export const reversalRefId = (creditLineId: string) => `${creditLineId}:reversal`
const r2 = (n: number) => Math.round(n * 100) / 100

export function planReinstate(input: ReinstateInput): ReinstatePlan {
  const { order, schedule } = input
  if (order.status === "canceled") return { ok: false, reason: "The order is cancelled." }

  // First: has this credit line already been reversed? Medusa re-ids credit
  // lines on every order version, so after a run the original id is gone and
  // only the reversal's reference_id still names it.
  if (
    order.credit_lines.some(
      (c) => c.reference === REVERSAL_REFERENCE && c.reference_id === reversalRefId(input.credit_line_id)
    )
  ) {
    return { ok: false, reason: `Credit line ${input.credit_line_id} has already been reversed.` }
  }

  const line = order.credit_lines.find((c) => c.id === input.credit_line_id)
  if (!line) return { ok: false, reason: `Credit line ${input.credit_line_id} is not on order ${order.id}.` }
  if (!(Number(line.amount) > 0)) {
    return { ok: false, reason: `Credit line ${line.id} is ${line.amount}; only a positive credit can be reversed.` }
  }

  if (!schedule) return { ok: false, reason: "The order has no payment schedule, so there is no balance to reinstate." }
  if (schedule.balance_status && schedule.balance_status !== "not_due") {
    return {
      ok: false,
      reason: `The balance is already "${schedule.balance_status}"; reinstating it now could double-charge. Reconcile by hand.`,
    }
  }
  if (schedule.deposit_status !== "paid") {
    return { ok: false, reason: `The deposit is "${schedule.deposit_status}", not paid.` }
  }

  const amount = r2(Number(line.amount))
  const total_before = r2(Number(order.total))
  const total_after = r2(total_before + amount)
  const net_paid = r2(Number(order.captured) - Number(order.refunded))
  const balance = r2(total_after - net_paid)

  if (!(net_paid > 0)) return { ok: false, reason: `Nothing was kept from the buyer (net paid ${net_paid}).` }
  if (!(balance > 0)) {
    return { ok: false, reason: `With the credit reversed the buyer would owe ${balance}; nothing to reinstate.` }
  }

  return {
    ok: true,
    reverse_amount: amount,
    total_before,
    total_after,
    net_paid,
    balance,
    schedule_update: { id: schedule.id, total_due: total_after, deposit_amount: net_paid, balance_amount: balance },
  }
}
