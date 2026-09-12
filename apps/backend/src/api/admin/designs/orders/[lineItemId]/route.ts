import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import designLineItemLink from "../../../../../links/design-line-item-link"
import designCustomerLink from "../../../../../links/design-customer-link"
import designOrderLink from "../../../../../links/design-order-link"
import { resolveLineItemDesignId } from "../../../../../lib/resolve-line-item-production"
import {
  buildOrderItemRow,
  summariseOrderItems,
} from "../order-items-view"
import { newestLinkPerLine } from "../newest-link-per-line"

/**
 * GET /admin/designs/orders/:lineItemId
 *
 * Returns a single design order item by line_item_id.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
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
        fields: ["id", "name", "status", "description", "thumbnail_url", "estimated_cost", "design_type", "priority", "target_completion_date"],
      }),
      query.graph({
        entity: designCustomerLink.entryPoint,
        filters: { design_id: designId },
        fields: ["design_id", "customer_id", "customer.*"],
      }).catch(() => ({ data: [] })),
      query.graph({
        entity: designOrderLink.entryPoint,
        filters: { design_id: designId },
        fields: [
          "design_id",
          "order_id",
          "order.id",
          "order.display_id",
          "order.status",
          "order.payment_status",
          "order.fulfillment_status",
          "order.total",
          "order.currency_code",
          "order.created_at",
          "order.canceled_at",
          "order.unified_order_status.partner_status",
          // Latest fulfillment carries the AWB/tracking stamped out-of-band by
          // the Shiprocket label/attach flows (#404/#437).
          "order.fulfillments.id",
          "order.fulfillments.data",
          "order.fulfillments.created_at",
          "order.fulfillments.canceled_at",
          "order.fulfillments.shipped_at",
          "order.fulfillments.delivered_at",
        ],
      }).catch(() => ({ data: [] })),
    ])

    const design = designResult.data?.[0]
    let customer = customerLinkResult.data?.[0]?.customer || null
    const orderLinkRows = orderLinkResult.data ?? []
    const order = orderLinkRows[0]?.order || null
    // A design can be linked to BOTH a retail purchase order AND a production
    // work-order; the partner work-status lives on the work-order, so surface it
    // from whichever linked order carries it (independent of which order we
    // display above). #403.
    const workStatus =
      orderLinkRows
        .map((r: any) => r?.order?.unified_order_status)
        .find((u: any) => u?.partner_status) || null

    // Surface the carrier/AWB/tracking stamped onto the latest active
    // fulfillment (the Shiprocket label/attach flows write it to
    // `fulfillment.data` against the manual provider). #437.
    const fulfillments = (order?.fulfillments || []) as any[]
    const activeFulfillment = fulfillments
      .filter((f: any) => !f.canceled_at)
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    const tracked =
      activeFulfillment.find((f: any) => f.data?.carrier) ?? activeFulfillment[0]
    const tracking = tracked
      ? {
          // The fulfillment this AWB is stamped on. Needed to cancel the
          // waybill from here — cancel is addressed per-fulfillment, and this
          // page otherwise never learns which one carries the shipment.
          fulfillment_id: tracked.id ?? null,
          carrier: tracked.data?.carrier ?? null,
          awb: tracked.data?.waybill ?? tracked.data?.tracking_number ?? null,
          tracking_url: tracked.data?.tracking_url ?? null,
          current_status: tracked.data?.current_status ?? null,
          shipped_at: tracked.shipped_at ?? null,
          delivered_at: tracked.delivered_at ?? null,
        }
      : null

    /**
     * #1946 — what each line stands for NOW, read from the ORDER.
     *
     * Everything above resolves through `design_line_item`, the CART-level link
     * whose own docblock says it dies at checkout. That link is deliberately
     * never rewritten: it records what was COMMISSIONED, which is the question
     * #1919 kept it around to answer.
     *
     * It is not the question this page asks once the order exists. Edit Items
     * re-points the ORDER-level link, so after a change the two genuinely
     * disagree — and Items, plus Production through `designById`, went on
     * showing the design the customer is no longer getting. No cache
     * invalidation could have fixed that; the data differs.
     *
     * The bridge is `metadata.source_cart_line_item_id`, stamped on every order
     * item by `convert-design-order`. Cart line -> order line -> the canonical
     * resolver, which already ranks the order link above the provenance string.
     * No new link, and nothing overwritten.
     *
     * Best-effort in both directions: an order we cannot read leaves the
     * commissioned view standing rather than blanking the screen.
     */
    let orderItems: ReturnType<typeof summariseOrderItems> | null = null
    /** cart line item id -> what the ORDER says that line is now. */
    const currentByCartLine = new Map<
      string,
      {
        orderItemId: string
        design: { id: string; name: string | null; source: string | null } | null
      }
    >()
    if (order?.id) {
      try {
        const { data: fullOrders } = await query.graph({
          entity: "order",
          filters: { id: order.id },
          fields: [
            "id",
            "items.id",
            "items.title",
            "items.subtitle",
            "items.thumbnail",
            "items.quantity",
            "items.unit_price",
            "items.variant_id",
            "items.product_id",
            "items.metadata",
            // Both: `items.quantity` comes back null in this graph shape, and
            // the detail row is what actually carries it.
            "items.detail.quantity",
            "items.detail.fulfilled_quantity",
            "items.detail.shipped_quantity",
            "items.detail.delivered_quantity",
          ],
        })
        const rawItems: any[] = fullOrders?.[0]?.items || []
        const rows = await Promise.all(
          rawItems.map(async (it: any) => {
            // Through the canonical resolver, so a pre-#1919 item resolves from
            // its metadata string instead of reading as design-less.
            const resolved = await resolveLineItemDesignId(query, {
              productId: it.product_id ?? null,
              variantId: it.variant_id ?? null,
              lineItemId: it.id,
              metadata: it.metadata ?? null,
            }).catch(() => ({ designId: null, source: null } as any))

            let designRef: { id: string; name: string | null; source: string | null } | null = null
            if (resolved?.designId) {
              const { data: ds } = await query.graph({
                entity: "design",
                fields: ["id", "name"],
                filters: { id: resolved.designId },
              })
              designRef = {
                id: resolved.designId,
                name: ds?.[0]?.name ?? null,
                source: resolved.source ?? null,
              }
            }

            const sourceCartLine = it?.metadata?.source_cart_line_item_id
            if (typeof sourceCartLine === "string" && sourceCartLine) {
              currentByCartLine.set(sourceCartLine, {
                orderItemId: it.id,
                design: designRef,
              })
            }
            return buildOrderItemRow(it, designRef)
          })
        )
        orderItems = summariseOrderItems(rows)
      } catch (e) {
        logger.warn(`[design-order detail] Failed to build order items view: ${e}`)
      }
    }

    /**
     * The design this page presents.
     *
     * The order wins wherever it has an opinion. The commissioned design stands
     * in only when there is no order line to ask — never to paper over a
     * DETACHED line, which is reported as detached instead of quietly showing
     * what it used to be.
     */
    const currentPrimary = currentByCartLine.get(lineItemId)
    const currentDesignId = currentPrimary?.design?.id ?? null
    const primaryDetached = Boolean(currentPrimary) && !currentPrimary?.design
    let presentedDesign = design
    if (currentDesignId && currentDesignId !== designId) {
      const { data: currentDesigns } = await query
        .graph({
          entity: "design",
          filters: { id: currentDesignId },
          fields: [
            "id",
            "name",
            "status",
            "description",
            "thumbnail_url",
            "estimated_cost",
            "design_type",
            "priority",
            "target_completion_date",
          ],
        })
        .catch(() => ({ data: [] }))
      if (currentDesigns?.[0]) presentedDesign = currentDesigns[0]
    }

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
      logger.warn(`[design-order detail] Failed to fetch line item: ${e}`)
    }

    // 4. Fetch cart details for currency and customer fallback
    let cartCurrencyCode: string | null = null
    if (lineItem?.cart_id) {
      try {
        const { data: carts } = await query.graph({
          entity: "cart",
          filters: { id: lineItem.cart_id },
          fields: ["customer_id", "currency_code"],
        })
        const cart = carts?.[0]
        cartCurrencyCode = cart?.currency_code || null
        if (!customer && cart?.customer_id) {
          try {
            const { data: customers } = await query.graph({
              entity: "customer",
              filters: { id: cart.customer_id },
              fields: ["id", "email", "first_name", "last_name"],
            })
            customer = customers?.[0] || null
          } catch {}
        }
      } catch {}
    }

    if (!customer) {
      let customerId: string | null = null

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
      /** The order says this line no longer stands for any design (#1946). */
      detached?: boolean;
      /** What it was ordered as, when that is not what it is now (#1946). */
      commissioned_design_id?: string | null;
      commissioned_design?: { id: string; name: string; status: string; estimated_cost?: number } | null;
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
          const { data: rawSiblingLinks } = await query.graph({
            entity: designLineItemLink.entryPoint,
            filters: { line_item_id: allCartLineItemIds },
            fields: ["design_id", "line_item_id", "created_at"],
          })
          // One row per line — see newest-link-per-line.ts for why this is
          // not a formality. Two rows meant two sibling rows for one garment.
          const siblingLinks = newestLinkPerLine(rawSiblingLinks as any[])
          /**
           * #1946 — a sibling shows what it stands for NOW, by the same
           * precedence as the primary: the order's binding where there is one,
           * the commissioned design where there is not.
           *
           * A DETACHED sibling still gets a row — it is a paid line and hiding
           * it would be a worse lie than showing it with the design it was
           * ordered as and saying so — so both ids are collected.
           */
          const siblingDesignIds = [...new Set(
            (siblingLinks || [])
              .filter((l: any) => l.line_item_id !== lineItemId)
              .flatMap((l: any) => [
                l.design_id,
                currentByCartLine.get(l.line_item_id)?.design?.id,
              ])
              .filter(Boolean)
          )] as string[]

          if (siblingDesignIds.length > 0) {
            const { data: siblingDesigns } = await query.graph({
              entity: "design",
              filters: { id: siblingDesignIds },
              fields: ["id", "name", "status", "estimated_cost", "design_type", "priority", "target_completion_date"],
            })
            const siblingDesignById: Record<string, any> = {}
            for (const d of siblingDesigns || []) siblingDesignById[d.id] = d

            for (const link of siblingLinks || []) {
              if (link.line_item_id === lineItemId) continue
              const current = currentByCartLine.get(link.line_item_id)
              const detached = Boolean(current) && !current?.design
              const shownId = current?.design?.id ?? link.design_id
              const d = siblingDesignById[shownId]
              const li = (cartLineItems || []).find((i: any) => i.id === link.line_item_id)
              if (d) {
                siblingItems.push({
                  design: { id: d.id, name: d.name, status: d.status, estimated_cost: d.estimated_cost },
                  line_item_id: link.line_item_id,
                  price: li?.unit_price ?? 0,
                  metadata: li?.metadata ?? null,
                  detached,
                  commissioned_design_id:
                    link.design_id && link.design_id !== shownId ? link.design_id : null,
                  /**
                   * The design this line was ORDERED as, as an object.
                   *
                   * 🔴 Production keys `designById` on `run.design_id`, and a
                   * run minted before a re-point still carries the ORIGINAL
                   * design. Returning only the current one emptied that lookup
                   * and every run card fell back to its snapshot name, losing
                   * the link, target date and cost. Both are returned so any
                   * run resolves — caught by rendering the page, not by a test.
                   */
                  commissioned_design:
                    link.design_id && link.design_id !== shownId
                      ? (() => {
                          const c = siblingDesignById[link.design_id]
                          return c
                            ? { id: c.id, name: c.name, status: c.status, estimated_cost: c.estimated_cost }
                            : null
                        })()
                      : null,
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
        design: presentedDesign
          ? { id: presentedDesign.id, name: presentedDesign.name, status: presentedDesign.status, description: presentedDesign.description, thumbnail_url: presentedDesign.thumbnail_url, estimated_cost: presentedDesign.estimated_cost, design_type: presentedDesign.design_type }
          : { id: designId, name: "Unknown", status: "" },
        /**
         * What this line was COMMISSIONED as, when that is no longer what it
         * is. Production needs it to draw a run minted before the re-point.
         */
        commissioned_design:
          design && design.id !== presentedDesign?.id
            ? { id: design.id, name: design.name, status: design.status, estimated_cost: design.estimated_cost, design_type: design.design_type, thumbnail_url: design.thumbnail_url }
            : null,
        /**
         * #1946 — where the design above came from, so the screen can say so
         * rather than presenting a re-pointed line as if nothing happened.
         *
         * `commissioned_design_id` is the CART link: what the customer
         * originally asked for. It is never rewritten, which is exactly why it
         * cannot also be the answer to "what are we making".
         */
        design_binding: {
          source: currentPrimary
            ? (currentPrimary.design?.source ?? "detached")
            : "cart",
          detached: primaryDetached,
          commissioned_design_id: designId,
          changed: Boolean(currentDesignId && currentDesignId !== designId),
          order_line_item_id: currentPrimary?.orderItemId ?? null,
        },
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
        currency_code: order?.currency_code || cartCurrencyCode || "inr",
        sibling_items: siblingItems,
        total_price: (lineItem?.unit_price ?? 0) + siblingItems.reduce((s, i) => s + i.price, 0),
        order: order
          ? {
              id: order.id,
              display_id: order.display_id,
              status: order.status,
              payment_status: order.payment_status,
              fulfillment_status: order.fulfillment_status,
              total: order.total,
              currency_code: order.currency_code,
              created_at: order.created_at,
              canceled_at: order.canceled_at ?? null,
              unified_order_status: workStatus,
              tracking,
            }
          : null,
        checkout_url: checkoutUrl,
        /** #1918 — ordered vs delivered, per item, with each item's design. */
        order_items: orderItems,
      },
    })
  } catch (error) {
    logger.error(`[design-order detail] Error: ${error}`, error)
    res.status(500).json({
      message: "Failed to fetch design order",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
