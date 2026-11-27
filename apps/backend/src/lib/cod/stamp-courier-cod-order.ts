import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { COD_COLLECT_KEY } from "./assert-courier-cod"
import { isCodProvider } from "./courier-cod"

/**
 * Stamp a courier cash-on-delivery order so the courier collects (2026-11-27).
 *
 * Every shipment path reads `order.metadata.payment_mode === "cod"` to book a
 * COD parcel with the order total as the amount to collect (admin carrier
 * booking: `buildCreateShipmentInput`; core fulfillment providers: Delhivery,
 * Shiprocket, Blue Dart). Without the stamp the parcel goes out prepaid and
 * the buyer pays nobody.
 *
 * The decision was made when the cart completed (`assertCourierCodAllowed`,
 * completeCart's validate hook), which records `cod_collect` on the CART —
 * always overwriting what the buyer may have put there, and before the cart
 * can change again. It can't live on the payment session: authorizing
 * replaces the session's data with the provider's `{}`. It must be read from
 * the cart, not the order: the order copied the cart's metadata BEFORE
 * validate wrote it.
 *
 */
export async function stampCourierCodOrder(
  container: any,
  orderId: string
): Promise<"stamped" | "not_cash" | "not_collect" | "missing"> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.status",
    ],
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) return "missing"
  // 🔴 An existing `payment_mode` is NOT trusted: the order copied the cart's
  // metadata, which the buyer can write ("prepaid" would ship it free). Only
  // `cod_collect`, written by the server at completion, decides.

  const sessions: any[] = (order.payment_collections ?? []).flatMap(
    (pc: any) => pc?.payment_sessions ?? []
  )
  const cash = sessions.some(
    (s) => isCodProvider(s?.provider_id) && String(s?.status ?? "") === "authorized"
  )
  if (!cash) return "not_cash"

  // 🔴 Through the link's own entry point: `order.cart` silently returns nothing.
  const { data: links } = await query.graph({
    entity: "order_cart",
    fields: ["cart_id"],
    filters: { order_id: orderId },
  })
  const cartId = links?.[0]?.cart_id
  if (!cartId) return "not_collect"
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata"],
    filters: { id: cartId },
  })
  if ((carts?.[0]?.metadata as any)?.[COD_COLLECT_KEY] !== true) return "not_collect"

  const orderModule: any = container.resolve(Modules.ORDER)
  await orderModule.updateOrders(orderId, {
    metadata: { ...(order.metadata ?? {}), payment_mode: "cod" },
  })
  return "stamped"
}
