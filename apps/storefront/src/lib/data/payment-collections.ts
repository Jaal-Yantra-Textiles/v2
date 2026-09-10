"use server"

import { sdk } from "@lib/config"

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
 * Fetch the collection and ensure it has a Stripe session.
 *
 * 🔴 POST, not GET, and `cache: "no-store"`. The backend mints a Stripe
 * PaymentIntent when the collection has no session — a cached or prefetched GET
 * would create intents on hover. It is idempotent server-side (an existing
 * session short-circuits), but the method still has to say what it does.
 *
 * Returns null when the id is not a live collection, so the page can render
 * "this link is not valid" rather than throwing a 500 at a buyer.
 */
export async function preparePaymentCollection(
  id: string
): Promise<PreparedPaymentCollection | null> {
  try {
    return await sdk.client.fetch<PreparedPaymentCollection>(
      `/store/payment-collections/${id}/prepare`,
      { method: "POST", cache: "no-store" }
    )
  } catch {
    return null
  }
}
