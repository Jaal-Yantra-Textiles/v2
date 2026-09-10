"use server"

import { sdk } from "@lib/config"
import { classifyPrepareFailure } from "@lib/util/payment-collection-error"

/**
 * The buyer-facing view of an outstanding payment collection (#1985).
 *
 * An order EDIT that raises the total leaves a second payment collection owing
 * the difference. The admin's "Copy payment link" hands the buyer a link to
 * this collection; the page it opens is the only place they can pay it.
 */
export type PreparedPaymentCollection = {
  payment_collection: {
    id: string
    amount: number
    currency_code: string
    status: string
    payment_session: {
      id: string
      provider_id: string
      status: string
      client_secret: string | null
    } | null
  }
  settled: boolean
  order: {
    id: string
    display_id: number | null
    currency_code: string | null
    email: string | null
    created_at: string | null
    total: number | null
    item_total: number | null
    /** What has already been captured on this order. */
    paid_total: number | null
    /** What the order still owes — equals the collection's amount. */
    pending_difference: number | null
    /** The total before the edit that created this balance. */
    original_order_total: number | null
    items: Array<{
      id: string
      title: string | null
      variant_title: string | null
      thumbnail: string | null
      quantity: number
      unit_price: number | null
      total: number | null
    }>
  } | null
}

/**
 * The three things that can happen, kept apart.
 *
 * 🔴 This used to be `PreparedPaymentCollection | null`, and `null` meant BOTH
 * "that link is dead" and "our backend is down" — so the page told a paying
 * customer their link was invalid when the fault was ours. A single nullable
 * cannot express whose fault it is, which is why this is a discriminated union
 * rather than an extra boolean beside the old return.
 *
 * ⚠️ The failure arms are spelled out as SEPARATE members rather than the
 * tidier `{ state: PrepareFailure }`. A member whose discriminant is itself a
 * union does not discriminate: narrowing `state === "unavailable"` and then
 * `state === "not_found"` never eliminates that single member, so the `ok` arm
 * is never reached and `result.prepared` does not typecheck.
 */
export type PreparedPaymentCollectionResult =
  | { state: "ok"; prepared: PreparedPaymentCollection }
  | { state: "not_found" }
  | { state: "unavailable" }

/**
 * Fetch the collection and ensure it has a Stripe session.
 *
 * 🔴 POST, not GET, and `cache: "no-store"`. The backend mints a Stripe
 * PaymentIntent when the collection has no session — a cached or prefetched GET
 * would create intents on hover. It is idempotent server-side (an existing
 * session short-circuits), but the method still has to say what it does.
 *
 * Never throws: a buyer holding a payment link must get a page that explains
 * itself, not a 500. But it no longer flattens every failure into one — see
 * `classifyPrepareFailure` for why only a 404 may blame the link.
 */
export async function preparePaymentCollection(
  id: string
): Promise<PreparedPaymentCollectionResult> {
  try {
    const prepared = await sdk.client.fetch<PreparedPaymentCollection>(
      `/store/payment-collections/${id}/prepare`,
      { method: "POST", cache: "no-store" }
    )
    return { state: "ok", prepared }
  } catch (error) {
    const state = classifyPrepareFailure(error)
    /*
     * 🔴 The old bare `catch {}` swallowed the outage as well as the message.
     * "The storefront deployed before the backend" was invisible in the logs —
     * the only evidence it happened at all was a customer saying their link did
     * not work. An outage on a payment page has to leave a trace.
     */
    if (state === "unavailable") {
      console.error(
        `[payment-collection] prepare failed for ${id} — treating as UNAVAILABLE (ours, not the buyer's):`,
        error
      )
    }
    return { state }
  }
}
