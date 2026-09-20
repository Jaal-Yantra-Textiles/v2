/**
 * Turning a promotion module's internal complaint into something a shopper can
 * act on (#2194, the guest half).
 *
 * ## Why this exists
 *
 * A promotion whose campaign meters "once per customer" is configured like
 * this:
 *
 * ```
 * budget.type      = use_by_attribute
 * budget.attribute = customer_id
 * budget.limit     = 1
 * ```
 *
 * To count uses, Medusa reads the buyer off the cart:
 *
 * ```js
 * customer_id: ctx.customer_id ?? ctx.customer?.id ?? null
 * ```
 *
 * …and throws when it is null. On an anonymous cart — which is every genuine
 * guest, and also every design order minted without `cart.customer_id` — the
 * shopper was shown the module's own string, typo included:
 *
 * > Attribute value for "customer_id" is required by promotion campaing budget
 *
 * The code is fine and the campaign is fine. The only thing missing is that we
 * do not know who is applying it, and the one thing the shopper can do about
 * that — sign in — was never mentioned.
 *
 * ⚠️ This is NOT the same failure as a bad code. A wrong code is the shopper's
 * mistake and "that code isn't valid" is the honest answer; this one is a
 * request for identification, and answering it with "invalid code" would send a
 * shopper holding a perfectly good code away.
 */

/**
 * PURE: does this failure mean "we need to know who you are", rather than
 * "that code is no good"? Exported for tests.
 *
 * ⚠️ Matches BOTH spellings of campaign on purpose. `campaing` is Medusa's own
 * typo in the thrown string; the day they fix it, a matcher keyed to the typo
 * would silently stop firing and the raw string would be back in front of
 * buyers with nothing failing anywhere. Requiring `customer_id` as well keeps
 * the other budget attributes (`spend`, plain `usage`) out of this branch —
 * those genuinely are exhausted budgets, not missing identity.
 */
export function isMissingCustomerPromotionError(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown })?.message ?? error ?? ""
  ).toLowerCase()

  return (
    message.includes("customer_id") &&
    (message.includes("campaing") || message.includes("campaign"))
  )
}

export const PROMOTION_REQUIRES_SIGN_IN_MESSAGE =
  "This code is limited to one use per customer, so we need to know who you are. Sign in or create an account, then apply it again."

export type PromotionFailure = {
  /** Safe to render to a shopper. */
  message: string
  /** Render a route to sign in beside the message. */
  requiresSignIn: boolean
}

/**
 * PURE: what to put in front of the shopper for a failed promotion apply.
 *
 * Anything we do not recognise keeps the server's own message — a wrong or
 * expired code already comes back readable ("Promotion with code FRIENDS does
 * not exist"), and swallowing those behind one generic sentence would lose
 * information the shopper needs.
 */
export function describePromotionFailure(
  error: unknown,
  fallback = "Failed to apply promotions"
): PromotionFailure {
  if (isMissingCustomerPromotionError(error)) {
    return { message: PROMOTION_REQUIRES_SIGN_IN_MESSAGE, requiresSignIn: true }
  }

  const message = String(
    (error as { message?: unknown })?.message ?? ""
  ).trim()

  return { message: message || fallback, requiresSignIn: false }
}
