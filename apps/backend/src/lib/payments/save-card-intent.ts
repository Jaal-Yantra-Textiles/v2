import type { CollectionPlan } from "./deposit-collection"

/**
 * Whether this payment session should ask Stripe to keep the buyer's card.
 *
 * ## Only when there is a second half to collect
 *
 * Storing someone's payment method is not free of consequence, so it is not
 * default-on. The single condition is that the collection is a **deposit** —
 * i.e. a balance is owed later and the alternative is emailing a procurement
 * contact a link and hoping. A `full` collection has nothing left to charge, so
 * keeping the card would buy nothing and store something anyway.
 *
 * 🔑 The decision reads `plan.basis`, the same figure that decided how much to
 * charge now. Re-deriving "is this a deposit?" from the schedule a second time
 * is how two answers to one question start to disagree — the plan is already
 * the one place that decision lives.
 *
 * ## Cards only
 *
 * `off_session` reuse works for cards. Our Stripe provider runs with
 * `automatic_payment_methods` enabled, so a session may also offer redirect
 * methods that can never be charged unattended. That is not a reason to refuse
 * the flag — the saved card is a *fast path*, and the balance pay link remains
 * the fallback for every buyer whose method cannot be reused or whose
 * off-session charge is declined.
 */
export const shouldSaveCardForLater = (plan: Pick<CollectionPlan, "basis">) =>
  plan.basis === "deposit"

/**
 * The `data` a Stripe payment session needs in order to keep the card.
 *
 * Returned as a spreadable object so a caller adds nothing at all when the
 * answer is no — an explicit `setup_future_usage: undefined` would still be a
 * key on the intent request, and the provider forwards `extra?.setup_future_usage`
 * straight through to Stripe.
 */
export const saveCardSessionData = (
  plan: Pick<CollectionPlan, "basis">
): { setup_future_usage?: "off_session" } =>
  shouldSaveCardForLater(plan) ? { setup_future_usage: "off_session" } : {}
