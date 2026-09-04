/**
 * The terms a quote-bound cart carries, from
 * `GET /store/carts/:id/quote-terms` (#1787).
 *
 * A cart minted by accepting a quote is not an ordinary basket — its prices are
 * held, and usually only a deposit is collected today. The storefront said none
 * of that, so a buyer saw the full total on `/cart` and met the 30% for the
 * first time at the Review step, if at all.
 *
 * 🔴 Every figure here is computed by the backend's `planCartCollection`, the
 * same function that decides what the payment collection is actually created
 * for. Do not re-derive a deposit in the browser: a page that computes its own
 * split is how the promise and the charge come to disagree.
 *
 * Lives outside `lib/data/cart.ts` because that file is `"use server"`, where
 * exports must be async functions.
 */
export type QuoteCartTerms = {
  /** False for an ordinary cart; every other field is then null. */
  is_quote_cart: boolean
  quote_id: string | null
  currency_code: string | null
  total: number | null
  /** Null when the whole total is due now — including a legitimate `deposit_pct: 100`. */
  deposit_due_now: number | null
  balance_due_later: number | null
  deposit_pct: number | null
  deposit_status: string | null
  balance_status: string | null
  rail: string | null
  /**
   * Set when the cart came from a quote but no split could be stated
   * confidently. Not an error — the cart is payable in full, and the storefront
   * should show the plain total rather than invent a split.
   */
  unavailable_reason: string | null
}
