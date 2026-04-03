import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import designLineItemLink from "../../../../../links/design-line-item-link"
import designCustomerLink from "../../../../../links/design-customer-link"
import designOrderLink from "../../../../../links/design-order-link"

/**
 * GET /admin/designs/orders/:lineItemId
 *
 * Returns a single design order item by line_item_id.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const { lineItemId } = req.params
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

    // 1. Find the design linked to this line item
    const { data: linkRows } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { line_item_id: lineItemId },
      fields: ["design_id", "line_item_id"],
    })

    if (!linkRows?.length) {
      res.status(404).json({ message: "Design order not found" })
      return
    }

    const designId = linkRows[0].design_id

    // 2. Fetch design, customer link, and order link in parallel
    const [designResult, customerLinkResult, orderLinkResult] = await Promise.all([
      query.graph({
        entity: "design",
        filters: { id: designId },
        fields: ["id", "name", "status", "description", "thumbnail_url", "estimated_cost", "design_type"],
      }),
      query.graph({
        entity: designCustomerLink.entryPoint,
        filters: { design_id: designId },
        fields: ["design_id", "customer_id", "customer.*"],
      }).catch(() => ({ data: [] })),
      query.graph({
        entity: designOrderLink.entryPoint,
        filters: { design_id: designId },
        fields: ["design_id", "order_id", "order.id", "order.display_id", "order.status", "order.total", "order.currency_code", "order.created_at"],
      }).catch(() => ({ data: [] })),
    ])

    const design = designResult.data?.[0]
    let customer = customerLinkResult.data?.[0]?.customer || null
    const order = orderLinkResult.data?.[0]?.order || null

    // 3. Fetch line item details from cart module
    const cartService = req.scope.resolve(Modules.CART) as any
    let lineItem: any = null
    try {
      const items = await cartService.listLineItems(
        { id: lineItemId },
        { select: ["id", "cart_id", "title", "unit_price", "quantity", "created_at", "metadata"] }
      )
      lineItem = items?.[0] || null
    } catch (e) {
      console.warn("[design-order detail] Failed to fetch line item:", e)
    }

    // 4. If no customer from design link, try the cart or order customer
    if (!customer) {
      let customerId: string | null = null

      if (lineItem?.cart_id) {
        try {
          const { data: carts } = await query.graph({
            entity: "cart",
            filters: { id: lineItem.cart_id },
            fields: ["customer_id"],
          })
          customerId = carts?.[0]?.customer_id || null
        } catch {}
      }

      if (!customerId && order) {
        try {
          const { data: orders } = await query.graph({
            entity: "order",
            filters: { id: order.id },
            fields: ["customer_id"],
          })
          customerId = orders?.[0]?.customer_id || null
        } catch {}
      }

      if (customerId) {
        try {
          const { data: customers } = await query.graph({
            entity: "customer",
            filters: { id: customerId },
            fields: ["id", "email", "first_name", "last_name"],
          })
          customer = customers?.[0] || null
        } catch {}
      }
    }

    // 5. Find all sibling items in the same cart (other designs in this order)
    const siblingItems: Array<{
      design: { id: string; name: string; status: string; estimated_cost?: number };
      line_item_id: string;
      price: number;
      metadata: any;
    }> = []

    if (lineItem?.cart_id) {
      try {
        // Get all line items in this cart
        const cartLineItems = await cartService.listLineItems(
          { cart_id: lineItem.cart_id },
          { select: ["id", "cart_id", "title", "unit_price", "metadata"] }
        )
        // Get design links for all line items in the cart
        const allCartLineItemIds = (cartLineItems || []).map((li: any) => li.id)
        if (allCartLineItemIds.length > 1) {
          const { data: siblingLinks } = await query.graph({
            entity: designLineItemLink.entryPoint,
            filters: { line_item_id: allCartLineItemIds },
            fields: ["design_id", "line_item_id"],
          })
          const siblingDesignIds = [...new Set(
            (siblingLinks || [])
              .filter((l: any) => l.line_item_id !== lineItemId)
              .map((l: any) => l.design_id)
          )] as string[]

          if (siblingDesignIds.length > 0) {
            const { data: siblingDesigns } = await query.graph({
              entity: "design",
              filters: { id: siblingDesignIds },
              fields: ["id", "name", "status", "estimated_cost"],
            })
            const siblingDesignById: Record<string, any> = {}
            for (const d of siblingDesigns || []) siblingDesignById[d.id] = d

            for (const link of siblingLinks || []) {
              if (link.line_item_id === lineItemId) continue
              const d = siblingDesignById[link.design_id]
              const li = (cartLineItems || []).find((i: any) => i.id === link.line_item_id)
              if (d) {
                siblingItems.push({
                  design: { id: d.id, name: d.name, status: d.status, estimated_cost: d.estimated_cost },
                  line_item_id: link.line_item_id,
                  price: li?.unit_price ?? 0,
                  metadata: li?.metadata ?? null,
                })
              }
            }
          }
        }
      } catch {
        // Non-fatal — sibling resolution is best-effort
      }
    }

    // 6. Build checkout URL for pending items
    const storeUrl = process.env.STORE_URL || "https://cicilabel.com"
    const checkoutUrl = !order && lineItem?.cart_id
      ? `${storeUrl}/checkout/cart/${lineItem.cart_id}`
      : null

    res.status(200).json({
      design_order: {
        design: design
          ? { id: design.id, name: design.name, status: design.status, description: design.description, thumbnail_url: design.thumbnail_url, estimated_cost: design.estimated_cost, design_type: design.design_type }
          : { id: designId, name: "Unknown", status: "" },
        customer: customer
          ? { id: customer.id, email: customer.email, first_name: customer.first_name, last_name: customer.last_name }
          : null,
        line_item_id: lineItemId,
        cart_id: lineItem?.cart_id ?? null,
        title: lineItem?.title ?? null,
        price: lineItem?.unit_price ?? 0,
        quantity: lineItem?.quantity ?? 1,
        added_at: lineItem?.created_at ?? null,
        metadata: lineItem?.metadata ?? null,
        sibling_items: siblingItems,
        total_price: (lineItem?.unit_price ?? 0) + siblingItems.reduce((s, i) => s + i.price, 0),
        order: order
          ? { id: order.id, display_id: order.display_id, status: order.status, total: order.total, currency_code: order.currency_code, created_at: order.created_at }
          : null,
        checkout_url: checkoutUrl,
      },
    })
  } catch (error) {
    console.error("[design-order detail] Error:", error)
    res.status(500).json({
      message: "Failed to fetch design order",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
