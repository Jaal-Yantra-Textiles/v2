import { MedusaError } from "@medusajs/framework/utils"

/**
 * How much to collect when a cart's payment collection is created (#1451).
 *
 * ## The defect this exists to close
 *
 * A quote's acceptance page promises a deposit — "Pay now (30%) €1,429.95,
 * balance on despatch €3,336.56" — and opens a `payment_schedule` row saying
 * the same. The payment rail then created the collection through core's
 * `createPaymentCollectionForCartWorkflow`, which hardcodes
 * `amount: cart.raw_total`. `deposit_amount` reached no payment session on any
 * rail. The buyer would have been charged €4,766.51 where the page said
 * €1,429.95 — 3.3x, at the moment of payment.
 *
 * ## Why the decision lives here and not in a rail
 *
 * Both rails take the amount from the payment COLLECTION: PayU signs
 * `session.amount` (`api/store/payu/intent/route.ts`), and Stripe's provider
 * builds the PaymentIntent from the session. So the collection's amount is the
 * single point that decides what a buyer is charged, and this is the single
 * function that decides the collection's amount. A second copy of this rule in
 * a rail is how the two rails come to disagree about what a deposit is.
 *
 * ## Why it refuses instead of falling back
 *
 * Every branch below that cannot confidently name a deposit REFUSES. It would
 * be easy to "fall back to the full total" — and that is precisely the bug,
 * written deliberately. A refusal is visible at checkout and gets fixed; a
 * wrong charge is invisible and gets reconciled months later. The one fallback
 * that IS safe is the absence of a schedule at all: an ordinary storefront cart
 * has no deposit and must be charged in full, exactly as before.
 */

/** The fields of a `payment_schedule` row this decision reads. */
export type CollectionSchedule = {
  id: string
  deposit_amount?: number | string | null
  total_due?: number | string | null
  deposit_status?: string | null
  currency_code?: string | null
}

export type CollectionPlan =
  | {
      basis: "full"
      amount: number
      schedule_id: null
      /** Why the full total is correct here — never a shrug. */
      reason: string
    }
  | {
      basis: "deposit"
      amount: number
      schedule_id: string
      reason: string
    }
  | {
      basis: "refuse"
      amount: null
      schedule_id: string
      reason: string
    }

const num = (v: unknown): number => Number(v)

/**
 * Decide the collection amount for a cart.
 *
 * `schedule` is the `payment_schedule` row found by `cart_id`, or null when the
 * cart is not a quote acceptance.
 */
export function planCartCollection(input: {
  cartTotal: number | string | null | undefined
  cartCurrency?: string | null
  schedule?: CollectionSchedule | null
}): CollectionPlan {
  const { schedule } = input
  const cartTotal = num(input.cartTotal)

  if (!schedule) {
    // The ordinary path: no deposit was ever promised, so the full total is the
    // honest amount. This branch must stay reachable and unchanged — every
    // non-quote cart in the store goes through it.
    return {
      basis: "full",
      amount: cartTotal,
      schedule_id: null,
      reason: "No payment schedule for this cart — the full total is due now.",
    }
  }

  const refuse = (reason: string): CollectionPlan => ({
    basis: "refuse",
    amount: null,
    schedule_id: schedule.id,
    reason,
  })

  /**
   * 🔴 Already paid. A second collection on a cart whose deposit landed would
   * charge the buyer again. The balance is a SEPARATE collection against the
   * order (#1451 slice 6, not built) — it is emphatically not "this cart, one
   * more time".
   */
  if (schedule.deposit_status === "paid") {
    return refuse(
      `Payment schedule ${schedule.id} already has a paid deposit; a second collection on this cart would charge the buyer twice.`
    )
  }

  if (schedule.deposit_status === "waived") {
    return refuse(
      `Payment schedule ${schedule.id} has a waived deposit, so there is nothing to collect now and the balance is not collected here.`
    )
  }

  /**
   * ⚠️ Currency FIRST, before any magnitude test — a comparison across
   * currencies is not a comparison at all. The prod ₹27,029.70 schedule against
   * a EUR cart would otherwise be refused as "a deposit larger than the cart",
   * which is a true sentence about two numbers and a false one about money, and
   * it would send whoever read it looking for the wrong bug. (A unit test
   * caught exactly this ordering; the amounts happened to make it visible.)
   *
   * The check matters because the amount is a bare number the rail signs: a
   * rupee figure charged as euros is #1538's remembered-rate error with the
   * arithmetic removed, and neither rail would notice.
   */
  const scheduleCurrency = String(schedule.currency_code ?? "").toLowerCase()
  const cartCurrency = String(input.cartCurrency ?? "").toLowerCase()
  if (scheduleCurrency && cartCurrency && scheduleCurrency !== cartCurrency) {
    return refuse(
      `Payment schedule ${schedule.id} is in ${scheduleCurrency.toUpperCase()} but the cart is in ${cartCurrency.toUpperCase()}.`
    )
  }

  const deposit = num(schedule.deposit_amount)

  /**
   * 🔑 `> 0`, not `!= null`. A stored 0 reads as a free deposit and would mint
   * a zero-amount collection the buyer sails through, arriving at a completed
   * order having paid nothing. `Number(null)` is also 0, so this one test
   * catches both spellings.
   */
  if (!Number.isFinite(deposit) || deposit <= 0) {
    return refuse(
      `Payment schedule ${schedule.id} carries no usable deposit amount (${String(
        schedule.deposit_amount
      )}), so what to charge now is unknown.`
    )
  }

  if (!Number.isFinite(cartTotal) || cartTotal <= 0) {
    return refuse(
      `Cart total is ${String(input.cartTotal)}, so a deposit cannot be checked against it.`
    )
  }

  /**
   * A deposit larger than the cart is a broken schedule, not a generous buyer.
   * Equal is fine and meaningful: `deposit_pct: 100` is a legitimate "pay in
   * full", and it must charge the total rather than being rejected as a
   * mismatch.
   */
  if (deposit > cartTotal) {
    return refuse(
      `Payment schedule ${schedule.id} asks for a deposit of ${deposit} against a cart total of ${cartTotal}.`
    )
  }

  return {
    basis: "deposit",
    amount: deposit,
    schedule_id: schedule.id,
    reason:
      deposit === cartTotal
        ? `Schedule ${schedule.id} is payable in full now.`
        : `Schedule ${schedule.id}: collecting the deposit of ${deposit}, with ${
            Math.round((cartTotal - deposit) * 100) / 100
          } to follow as the balance.`,
  }
}

/** Turn a refusal into the error a checkout should show. */
export function assertCollectable(plan: CollectionPlan): void {
  if (plan.basis === "refuse") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, plan.reason)
  }
}
