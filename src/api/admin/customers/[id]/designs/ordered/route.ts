import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designOrderLink from "../../../../../../links/design-order-link"
import designLineItemLink from "../../../../../../links/design-line-item-link"

/**
 * Returns designs that have been sent to checkout for this customer.
 * Includes both:
 * - Designs linked to completed orders (via design-order link)
 * - Designs linked to pending carts (via design-line-item link on cart)
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const designMap: Record<string, { order_ids: string[]; cart_ids: string[]; status: "pending" | "completed" }> = {}

  // 1. Find designs linked to completed orders
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { customer_id: customerId },
    fields: ["id"],
  })

  if (orders?.length) {
    const orderIds = orders.map((o: any) => o.id)

    const { data: designOrderLinks } = await query.graph({
      entity: designOrderLink.entryPoint,
      filters: { order_id: orderIds },
      fields: ["design_id", "order_id"],
    })

    for (const link of designOrderLinks || []) {
      if (!designMap[link.design_id]) {
        designMap[link.design_id] = { order_ids: [], cart_ids: [], status: "completed" }
      }
      designMap[link.design_id].order_ids.push(link.order_id)
      designMap[link.design_id].status = "completed"
    }
  }

  // 2. Find designs linked to pending carts via line items
  // Query carts with their line items nested
  const { data: carts } = await query.graph({
    entity: "cart",
    filters: { customer_id: customerId },
    fields: ["id", "items.id", "items.metadata"],
  })

  if (carts?.length) {
    // Collect all line item IDs and map them back to cart IDs
    const lineItemCartMap: Record<string, string> = {}
    const allLineItemIds: string[] = []

    for (const cart of carts) {
      for (const item of cart.items || []) {
        lineItemCartMap[item.id] = cart.id
        allLineItemIds.push(item.id)
      }
    }

    if (allLineItemIds.length > 0) {
      try {
        const { data: designLineItemLinks } = await query.graph({
          entity: designLineItemLink.entryPoint,
          filters: { line_item_id: allLineItemIds },
          fields: ["design_id", "line_item_id"],
        })

        for (const link of designLineItemLinks || []) {
          const cartId = lineItemCartMap[link.line_item_id]
          if (!cartId) continue

          if (!designMap[link.design_id]) {
            designMap[link.design_id] = { order_ids: [], cart_ids: [], status: "pending" }
          }
          if (!designMap[link.design_id].cart_ids.includes(cartId)) {
            designMap[link.design_id].cart_ids.push(cartId)
          }
        }
      } catch {
        // Link table may not have data yet
      }
    }
  }

  const designIds = Object.keys(designMap)
  if (designIds.length === 0) {
    res.status(200).json({ designs: [] })
    return
  }

  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designIds },
    fields: [
      "id",
      "name",
      "description",
      "status",
      "design_type",
      "thumbnail_url",
      "estimated_cost",
    ],
  })

  const storeUrl = process.env.STORE_URL || "https://cicilabel.com"

  const result = (designs || []).map((d: any) => {
    const entry = designMap[d.id]
    const cartIds = entry?.cart_ids || []
    const isPending = entry?.status === "pending"

    return {
      ...d,
      order_ids: entry?.order_ids || [],
      cart_ids: cartIds,
      checkout_status: entry?.status || "pending",
      checkout_url: isPending && cartIds.length > 0
        ? `${storeUrl}/api/cart/${cartIds[0]}/checkout`
        : null,
    }
  })

  res.status(200).json({ designs: result })
}
