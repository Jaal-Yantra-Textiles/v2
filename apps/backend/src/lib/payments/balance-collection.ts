/**
 * Collecting the SECOND half of a quote's payment — the balance.
 *
 * ## Why this exists at all
 *
 * `markBalanceDue` and `markBalancePaid` have been on the payment-schedule
 * service since #1451, fully written, guarded, and **never called by
 * anything**. A buyer paid a 30% deposit on a real order (A$94.43 of A$314.77)
 * and the remaining A$220.34 sat at `not_due` with no route, subscriber,
 * workflow or tool that could ever move it. A helper with tests and no caller
 * is not a feature.
 *
 * ## Why the partner raises it, not a timer
 *
 * The balance becomes payable when the goods exist — and the people who know
 * that are the partners making them. One order may be realised by several
 * partners, so this is an explicit ACTIVATION by a partner working the order,
 * not a schedule fired by a clock. A clock would ask a buyer for money against
 * goods nobody has made.
 *
 * ## Why two charges rather than one held authorisation
 *
 * Settled in the payment-schedule model and repeated here because it is the
 * question everyone asks: an online card authorisation lasts ~7 days, a
 * made-to-order lead time does not, and Stripe's own guidance is to take a
 * second payment rather than stretch an auth. So the balance is its own
 * payment collection and its own link.
 *
 * Pure. Every refusal is decided here so it can be tested without a container.
 */

export type BalanceSchedule = {
  id: string
  currency_code?: string | null
  total_due?: number | string | null
  deposit_amount?: number | string | null
  deposit_status?: string | null
  balance_amount?: number | string | null
  balance_status?: string | null
  order_id?: string | null
  rail?: string | null
}

export type BalancePlan =
  | {
      collectable: true
      schedule_id: string
      order_id: string
      amount: number
      currency_code: string
      reason: string
    }
  | {
      collectable: false
      schedule_id: string
      /** Machine-readable so a caller can tell "already paid" from "not allowed". */
      code:
        | "already_paid"
        | "waived"
        | "deposit_unpaid"
        | "no_order"
        | "no_amount"
        | "no_currency"
      reason: string
    }

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Decide whether a balance can be asked for, and for how much.
 *
 * 🔑 The amount comes from the schedule's stored `balance_amount`, not from
 * `total_due - deposit_amount` recomputed here. The split was decided and
 * written down when the deal was struck; recomputing it invites a second
 * opinion about a number the buyer has already been shown, and the two would
 * drift the first time a rounding rule changed.
 */
export const planBalanceCollection = (
  schedule: BalanceSchedule | null | undefined
): BalancePlan => {
  if (!schedule) {
    return {
      collectable: false,
      schedule_id: "",
      code: "no_order",
      reason: "This order has no payment schedule, so there is no balance to collect.",
    }
  }

  const id = schedule.id

  /**
   * Paid and waived first — both are terminal, and asking again is how a buyer
   * gets charged twice. Reported as success-shaped refusals, not errors: a
   * partner pressing the button twice has done nothing wrong.
   */
  if (schedule.balance_status === "paid") {
    return {
      collectable: false,
      schedule_id: id,
      code: "already_paid",
      reason: "The balance on this order has already been paid.",
    }
  }
  if (schedule.balance_status === "waived") {
    return {
      collectable: false,
      schedule_id: id,
      code: "waived",
      reason: "The balance on this order was waived, so nothing is collected.",
    }
  }

  /**
   * 🔴 An unpaid deposit means asking for the balance is a demand for money
   * against nothing. The service refuses this too; it is repeated here so the
   * caller can say WHY without catching an exception.
   */
  if (schedule.deposit_status !== "paid" && schedule.deposit_status !== "waived") {
    return {
      collectable: false,
      schedule_id: id,
      code: "deposit_unpaid",
      reason: `The deposit on this order is ${
        schedule.deposit_status ?? "unknown"
      }, so the balance cannot be raised yet.`,
    }
  }

  if (!schedule.order_id) {
    return {
      collectable: false,
      schedule_id: id,
      code: "no_order",
      reason:
        "This schedule is not attached to an order yet, so there is nothing to collect against.",
    }
  }

  const amount = num(schedule.balance_amount)
  // `> 0`, not `!= null` — `Number(null)` is 0, and a stored 0 means there is
  // nothing left to collect, not that the balance is free.
  if (amount === null || amount <= 0) {
    return {
      collectable: false,
      schedule_id: id,
      code: "no_amount",
      reason: `This order's balance is ${String(
        schedule.balance_amount
      )}, so there is nothing to collect.`,
    }
  }

  const currency = schedule.currency_code?.trim()
  if (!currency) {
    return {
      collectable: false,
      schedule_id: id,
      code: "no_currency",
      reason:
        "The schedule names no currency, so a charge cannot be denominated. Refusing rather than guessing.",
    }
  }

  return {
    collectable: true,
    schedule_id: id,
    order_id: schedule.order_id,
    amount,
    currency_code: currency.toLowerCase(),
    reason: `Collecting the balance of ${amount} ${currency.toUpperCase()} on order ${
      schedule.order_id
    }.`,
  }
}

/**
 * The public URL a buyer opens to pay the balance.
 *
 * Keyed on the SCHEDULE, not the payment collection: the schedule id is the
 * one identifier that survives a retry (a failed session is deleted and
 * remade), so a link already sent by email keeps working.
 *
 * ⚠️ The id is the credential, exactly as it is for the deposit's own hosted
 * page and for a PayU link. It must stay unguessable, which a ULID is.
 */
export const buildBalancePayUrl = (
  backendUrl: string,
  scheduleId: string
): string => `${backendUrl.replace(/\/+$/, "")}/stripe/pay/balance/${scheduleId}`

/**
 * Has the balance actually landed?
 *
 * ## 🔴 Why this is polled rather than pushed
 *
 * There is no event to subscribe to. `@medusajs/payment` does not reference the
 * event bus at all — it emits nothing, so a `payment.captured` subscriber would
 * be a handler that never fires, which is exactly the kind of check that reads
 * as a pass forever. The deposit escapes this because `order.placed` exists;
 * the balance is charged after the order, so nothing announces it.
 *
 * So the truth is READ from the collection: what did its payments actually
 * capture or authorise. Two callers share this one rule — the buyer's return to
 * the payment page (fast path) and a maintenance sweep (backstop) — so the two
 * cannot come to different conclusions about the same money.
 *
 * `captured` counts. `authorized` does not: an authorisation is a hold that
 * still has to be captured, and marking a schedule paid on a hold would report
 * money we have not taken.
 */
export type BalancePaymentState = {
  captured: number
  authorized: number
  currency_code: string | null
}

export const summariseBalancePayments = (
  collection:
    | { currency_code?: string | null; payments?: Array<Record<string, any>> | null }
    | null
    | undefined
): BalancePaymentState => {
  const payments = collection?.payments ?? []
  let captured = 0
  let authorized = 0

  for (const p of payments) {
    const amount = num(p?.amount) ?? 0
    // A refunded/canceled payment must not count towards the balance.
    if (p?.canceled_at) continue

    const refunded = num(p?.refunded_total) ?? 0
    if (p?.captured_at) {
      captured += amount - refunded
    } else {
      authorized += amount
    }
  }

  return {
    captured: Math.round(captured * 100) / 100,
    authorized: Math.round(authorized * 100) / 100,
    currency_code: collection?.currency_code ?? null,
  }
}

export type BalanceSettlement =
  | { settled: true; captured: number; reason: string }
  | { settled: false; captured: number; reason: string }

/**
 * Decide whether a `due` balance may be marked paid.
 *
 * 🔑 Compares to the cent and requires the FULL expected amount. A partial
 * capture is left `due` on purpose: "mostly paid" is not paid, and marking it
 * so would close the only signal that the rest is still owed.
 */
export const settleBalance = (
  expectedAmount: number | string | null | undefined,
  state: BalancePaymentState
): BalanceSettlement => {
  const expected = num(expectedAmount)

  if (expected === null || expected <= 0) {
    return {
      settled: false,
      captured: state.captured,
      reason: "No balance amount is expected, so nothing can be settled.",
    }
  }

  const cents = (n: number) => Math.round(n * 100)

  if (cents(state.captured) >= cents(expected)) {
    return {
      settled: true,
      captured: state.captured,
      reason: `Captured ${state.captured} against an expected ${expected}.`,
    }
  }

  if (state.captured > 0) {
    return {
      settled: false,
      captured: state.captured,
      reason: `Only ${state.captured} of ${expected} has been captured — left due rather than closed on a partial payment.`,
    }
  }

  if (state.authorized > 0) {
    return {
      settled: false,
      captured: state.captured,
      reason: `${state.authorized} is authorised but not captured. An authorisation is a hold, not money received.`,
    }
  }

  return {
    settled: false,
    captured: 0,
    reason: "Nothing has been captured against the balance yet.",
  }
}
