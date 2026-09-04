import {
  planCartCollection,
  type CollectionPlan,
  type CollectionSchedule,
} from "../../../../../lib/payments/deposit-collection"

/**
 * What a buyer needs to be TOLD about a quote-bound cart, for
 * `GET /store/carts/:id/quote-terms` (#1787).
 *
 * ## Why this exists
 *
 * A cart minted by `acceptQuoteWorkflow` is not an ordinary basket: its prices
 * are frozen, its freight was rated in one lane, and — usually — only a deposit
 * is collected now. The storefronts rendered none of that. A buyer landed on
 * `/cart`, saw the full total with no mention of a deposit, and the first hint
 * that she owed 30% today appeared at the Review step, if at all.
 *
 * 🔴 The deposit shown here is computed by `planCartCollection`, the SAME
 * function that decides what the payment collection is actually created for.
 * Advertising a number derived any other way is how a page comes to promise
 * one figure and a gateway to charge another — which is exactly the class of
 * defect that made this quote unpayable in the first place.
 *
 * Kept pure so the arithmetic is testable without a container.
 */
export type QuoteCartTerms = {
  /** False for an ordinary cart; everything below is then null. */
  is_quote_cart: boolean
  quote_id: string | null
  currency_code: string | null
  /** The cart's own total — what is owed in the end, deposit or not. */
  total: number | null
  /**
   * Null when the whole total is due now. A number here means the buyer is
   * asked for THIS today and the rest later.
   */
  deposit_due_now: number | null
  balance_due_later: number | null
  deposit_pct: number | null
  deposit_status: string | null
  balance_status: string | null
  /** `payu` | `stripe` | `manual` — which rail will take it. */
  rail: string | null
  /**
   * 🔴 Present when the cart is bound to a quote but the terms could NOT be
   * stated confidently — a schedule that names no usable deposit, or one that
   * disagrees with the cart. The storefront must fall back to showing the plain
   * total rather than inventing a split, and this says why.
   *
   * Not an error: the cart is still perfectly payable in full.
   */
  unavailable_reason: string | null
}

const NOT_A_QUOTE_CART: QuoteCartTerms = {
  is_quote_cart: false,
  quote_id: null,
  currency_code: null,
  total: null,
  deposit_due_now: null,
  balance_due_later: null,
  deposit_pct: null,
  deposit_status: null,
  balance_status: null,
  rail: null,
  unavailable_reason: null,
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function deriveQuoteCartTerms(
  cart:
    | {
        id?: string
        currency_code?: string | null
        total?: number | string | null
        metadata?: Record<string, unknown> | null
      }
    | null
    | undefined,
  /**
   * Extends `CollectionSchedule` — the exact shape the pricer reads — rather
   * than restating it. A hand-written copy is how the two come to disagree
   * about which fields are optional, and the pricer's opinion is the one that
   * decides what the buyer is charged.
   */
  schedule:
    | (CollectionSchedule & {
        deposit_pct?: number | string | null
        balance_status?: string | null
        rail?: string | null
      })
    | null
    | undefined
): QuoteCartTerms {
  const quoteId = cart?.metadata?.quote_id

  /**
   * `metadata.quote_id` is the marker `acceptQuoteWorkflow` stamps, and it is
   * the same marker the storefronts use to refuse a re-region. One definition
   * of "this is a quote cart", not two.
   */
  if (!quoteId) {
    return NOT_A_QUOTE_CART
  }

  const total = num(cart?.total)
  const base = {
    ...NOT_A_QUOTE_CART,
    is_quote_cart: true,
    quote_id: String(quoteId),
    currency_code: cart?.currency_code ?? null,
    total,
    deposit_status: schedule?.deposit_status ?? null,
    balance_status: schedule?.balance_status ?? null,
    rail: schedule?.rail ?? null,
    deposit_pct: num(schedule?.deposit_pct),
  }

  if (!schedule) {
    return {
      ...base,
      unavailable_reason:
        "This cart came from a quote but carries no payment schedule, so the whole total is due now.",
    }
  }

  let plan: CollectionPlan
  try {
    plan = planCartCollection({
      cartTotal: cart?.total,
      cartCurrency: cart?.currency_code,
      schedule,
    })
  } catch (e) {
    return {
      ...base,
      unavailable_reason: e instanceof Error ? e.message : String(e),
    }
  }

  /**
   * A refused plan is reported, never guessed around. `planCartCollection`
   * refuses a deposit it cannot name confidently — a zero amount, a deposit
   * larger than the cart, a currency that does not match. In every one of those
   * cases the honest thing to show a buyer is the plain total.
   */
  if (plan.basis === "refuse") {
    return { ...base, unavailable_reason: plan.reason }
  }

  if (plan.basis !== "deposit") {
    // A legitimate "pay in full" quote — `deposit_pct: 100`, or a waived
    // deposit. It IS a quote cart (frozen prices still worth saying), it just
    // has no split to advertise.
    return { ...base, unavailable_reason: null }
  }

  const depositDue = num(plan.amount)
  const balance =
    depositDue !== null && total !== null
      ? Math.round((total - depositDue) * 100) / 100
      : null

  /**
   * 🔴 A `deposit` basis whose amount IS the whole total is `deposit_pct: 100`
   * — "pay in full", which `planCartCollection` accepts deliberately. Rendering
   * it as a split would show the buyer "Pay now A$314.77, balance A$0.00",
   * which is noise dressed as a payment plan. There is no split to advertise.
   */
  if (balance === null || balance <= 0) {
    return base
  }

  return {
    ...base,
    deposit_due_now: depositDue,
    balance_due_later: balance,
  }
}
