import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import designLineItemLink from "../../links/design-line-item-link"
import designOrderLink from "../../links/design-order-link"
import { DESIGN_MODULE } from "../../modules/designs"

/**
 * Close the purchase loop for design orders (roadmap #29 / issue #379).
 *
 * Designs get linked to CART line items when they're added to a cart
 * (design_line_item). When the customer completes the cart, an order is
 * created — but nothing carried the design linkage onto the order, so
 * the admin "Design Orders" view kept showing those purchases as
 * "In Cart"/pending forever.
 *
 * Resolution path: order → order_cart link → cart line items →
 * design_line_item links → upsert design_order links.
 *
 * NOTE: order.cart_id is NOT a column on the order model — order↔cart
 * is the `order_cart` link module. The previous subscriber code selected
 * `cart_id` off the order and silently no-oped (the original #379 bug).
 *
 * Idempotent: existing (design, order) pairs are skipped. Shared by the
 * order.placed subscriber and the backfill script.
 */
export async function linkDesignsToOrder(
  container: MedusaContainer,
  orderId: string,
  opts?: { dryRun?: boolean }
): Promise<{ linked: number; design_ids: string[] }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  // order → cart (link module, not a column)
  const { data: orderCarts } = await query.graph({
    entity: "order_cart",
    filters: { order_id: orderId },
    fields: ["cart_id"],
  })
  const cartId: string | undefined = orderCarts?.[0]?.cart_id
  if (!cartId) {
    return { linked: 0, design_ids: [] }
  }

  // cart → line items
  const cartService = container.resolve(Modules.CART) as any
  const cartLineItems = await cartService.listLineItems(
    { cart_id: [cartId] },
    { select: ["id"] }
  )
  const lineItemIds = (cartLineItems || []).map((li: any) => li.id)
  if (!lineItemIds.length) {
    return { linked: 0, design_ids: [] }
  }

  // line items → designs
  const { data: designLinks } = await query.graph({
    entity: designLineItemLink.entryPoint,
    filters: { line_item_id: lineItemIds },
    fields: ["design_id"],
  })
  const designIds = [
    ...new Set(
      (designLinks || [])
        .map((dl: any) => dl.design_id)
        .filter(Boolean) as string[]
    ),
  ]
  if (!designIds.length) {
    return { linked: 0, design_ids: [] }
  }

  // skip pairs that already exist
  const { data: existing } = await query.graph({
    entity: designOrderLink.entryPoint,
    filters: { order_id: orderId, design_id: designIds },
    fields: ["design_id"],
  })
  const already = new Set((existing || []).map((r: any) => r.design_id))

  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const linkedDesigns: string[] = []
  for (const designId of designIds) {
    if (already.has(designId)) continue
    if (!opts?.dryRun) {
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.ORDER]: { order_id: orderId },
      })
    }
    linkedDesigns.push(designId)
  }

  return { linked: linkedDesigns.length, design_ids: linkedDesigns }
}
