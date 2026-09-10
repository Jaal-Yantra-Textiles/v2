/**
 * POST /store/payment-collections/:id/prepare — everything the storefront's
 * payment-collection page needs, in one call (#1985).
 *
 * An order EDIT that raises the total leaves a second payment collection owing
 * the difference, with NO payment sessions — nothing in the edit flow mints
 * one. This route makes that collection payable: it ensures a Stripe session
 * exists and returns the collection alongside a minimal summary of the order
 * the money belongs to, so the buyer can see WHAT they are paying for rather
 * than a bare amount.
 *
 * ## Why POST and not GET
 *
 * Ensuring a session creates a Stripe PaymentIntent. A GET that mints one would
 * be triggered by link prefetchers, crawlers and preview bots — every hover
 * over the link would bill a little more Stripe API traffic and litter the
 * account with abandoned intents. The write is explicit, so the method is.
 *
 * ## What it deliberately does NOT accept
 *
 * The admin's copy-link carries `?order_id=…`, and this route ignores it. The
 * order is derived from the COLLECTION server-side; trusting an order id from a
 * URL would let one payment link report another order's contents.
 *
 * ## Exposure
 *
 * The collection id is the credential, exactly as it is for the deposit's
 * hosted page, the balance page and a PayU link — an unguessable ULID handed to
 * one buyer. The order summary is therefore kept to what a buyer already knows
 * from their own confirmation email: display id, currency, totals and line
 * titles/quantities. No addresses, no customer record, no payment history.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  ensureStripeSessionForCollection,
  isCollectionSettled,
  resolveCollectionOrderRouting,
} from "../../../../../lib/payments/ensure-stripe-session"

/** PURE: the buyer-safe shape of an order line. Exported for unit testing. */
export function summariseOrderLine(item: any) {
  return {
    id: item?.id,
    title: item?.title ?? null,
    variant_title: item?.variant_title ?? null,
    thumbnail: item?.thumbnail ?? null,
    quantity: Number(item?.quantity) || 0,
    unit_price: item?.unit_price ?? null,
    total: item?.total ?? null,
  }
}

/**
 * PURE: the buyer-safe shape of the order behind a collection.
 *
 * Allow-list, never a delete-list: a field added to the order later must not
 * appear here by default. Exported for unit testing.
 */
export function summariseOrder(order: any) {
  if (!order) return null
  return {
    id: order.id,
    display_id: order.display_id ?? null,
    currency_code: order.currency_code ?? null,
    email: order.email ?? null,
    created_at: order.created_at ?? null,
    total: order.total ?? null,
    item_total: order.item_total ?? null,
    items: ((order.items ?? []) as any[]).map(summariseOrderLine),
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const collectionId = req.params.id
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { collection, session } = await ensureStripeSessionForCollection(
    req.scope,
    collectionId
  )

  if (!collection) {
    res.status(404).json({ message: "This payment link is not valid." })
    return
  }

  const routing = await resolveCollectionOrderRouting(
    req.scope,
    collectionId
  ).catch(() => ({ regionProviderIds: [] }) as any)

  let order: any = null
  if (routing.orderId) {
    const { data } = await query
      .graph({
        entity: "order",
        filters: { id: routing.orderId },
        fields: [
          "id",
          "display_id",
          "currency_code",
          "email",
          "created_at",
          "total",
          "item_total",
          "items.id",
          "items.title",
          "items.variant_title",
          "items.thumbnail",
          "items.quantity",
          "items.unit_price",
          "items.total",
        ],
      })
      .catch(() => ({ data: [] }))
    order = data?.[0] ?? null
  }

  res.status(200).json({
    payment_collection: {
      id: collection.id,
      amount: collection.amount,
      currency_code: collection.currency_code,
      status: collection.status,
      // Only the Stripe session, and only the fields the Payment Element needs.
      // The raw session `data` carries provider internals a buyer has no use
      // for; `client_secret` is the one field that must cross.
      payment_session: session
        ? {
            id: session.id,
            provider_id: session.provider_id,
            status: session.status,
            client_secret: (session.data as any)?.client_secret ?? null,
          }
        : null,
    },
    settled: isCollectionSettled(collection),
    order: summariseOrder(order),
  })
}
