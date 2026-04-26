import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import designLineItemLink from "../../../../links/design-line-item-link";
import designCustomerLink from "../../../../links/design-customer-link";
import designOrderLink from "../../../../links/design-order-link";

/**
 * GET /admin/designs/orders
 *
 * Returns design orders grouped by cart. Designs that share the same cart
 * are returned as a single design order with multiple items, reflecting that
 * they were created together via the draft-order-from-designs workflow.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any;
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;

    // 1. Query the design → cart line item pivot table to get all linked pairs
    const { data: linkRows } = await query.graph({
      entity: designLineItemLink.entryPoint,
      fields: ["design_id", "line_item_id"],
    });

    if (!linkRows || linkRows.length === 0) {
      res.status(200).json({ design_orders: [], count: 0, offset, limit });
      return;
    }

    const designIds = [...new Set(linkRows.map((r: any) => r.design_id))] as string[];
    const lineItemIds = linkRows.map((r: any) => r.line_item_id) as string[];

    // 2. Fetch design details + linked customer + linked orders in parallel
    const [designsResult, customerLinksResult, orderLinksResult] = await Promise.all([
      query.graph({
        entity: "design",
        filters: { id: designIds },
        fields: ["id", "name", "status", "estimated_cost"],
      }),
      query.graph({
        entity: designCustomerLink.entryPoint,
        filters: { design_id: designIds },
        fields: ["design_id", "customer_id", "customer.*"],
      }),
      query.graph({
        entity: designOrderLink.entryPoint,
        filters: { design_id: designIds },
        fields: ["design_id", "order_id", "order.id", "order.display_id", "order.status", "order.total", "order.currency_code", "order.created_at"],
      }),
    ]);

    // Build lookup maps
    const designById: Record<string, any> = {};
    for (const d of designsResult.data as any[]) {
      designById[d.id] = d;
    }

    const customerByDesignId: Record<string, any> = {};
    for (const cl of customerLinksResult.data as any[]) {
      if (cl.design_id && cl.customer) {
        customerByDesignId[cl.design_id] = cl.customer;
      }
    }

    const orderByDesignId: Record<string, any> = {};
    for (const ol of orderLinksResult.data as any[]) {
      if (ol.design_id && ol.order) {
        orderByDesignId[ol.design_id] = ol.order;
      }
    }

    // 3. Fetch cart line items to get cart_id and price
    const cartService = req.scope.resolve(Modules.CART) as any;
    const cartLineItems = await cartService.listLineItems(
      { id: lineItemIds },
      { select: ["id", "cart_id", "unit_price", "created_at", "metadata"] }
    );

    const lineItemById: Record<string, any> = {};
    for (const li of cartLineItems as any[]) {
      lineItemById[li.id] = li;
    }

    // 4. Resolve cart details and customers
    const cartIds = [...new Set(
      (cartLineItems as any[]).map((li: any) => li.cart_id).filter(Boolean)
    )] as string[];

    const cartById: Record<string, any> = {};
    const customerByCartId: Record<string, any> = {};
    if (cartIds.length > 0) {
      try {
        const { data: carts } = await query.graph({
          entity: "cart",
          filters: { id: cartIds },
          fields: ["id", "customer_id", "currency_code", "metadata", "created_at", "completed_at"],
        });
        for (const cart of carts || []) {
          cartById[cart.id] = cart;
        }
        const customerIds = [...new Set(
          (carts || []).map((c: any) => c.customer_id).filter(Boolean)
        )];
        if (customerIds.length > 0) {
          const { data: customers } = await query.graph({
            entity: "customer",
            filters: { id: customerIds },
            fields: ["id", "email", "first_name", "last_name"],
          });
          const customerById: Record<string, any> = {};
          for (const c of customers || []) {
            customerById[c.id] = c;
          }
          for (const cart of carts || []) {
            if (cart.customer_id && customerById[cart.customer_id]) {
              customerByCartId[cart.id] = customerById[cart.customer_id];
            }
          }
        }
      } catch {}
    }

    // 5. Group by cart_id — designs in the same cart form a single design order
    const ordersByCartId = new Map<string, {
      cart_id: string;
      cart: any;
      customer: any;
      items: any[];
      order: any;
      created_at: string | null;
      total_price: number;
    }>();

    for (const linkRow of linkRows as any[]) {
      const design = designById[linkRow.design_id];
      const lineItem = lineItemById[linkRow.line_item_id];
      const order = orderByDesignId[linkRow.design_id] || null;
      const cartId = lineItem?.cart_id ?? "unknown";

      const customer = customerByDesignId[linkRow.design_id]
        || (lineItem?.cart_id ? customerByCartId[lineItem.cart_id] : null)
        || null;

      if (!ordersByCartId.has(cartId)) {
        const cart = cartById[cartId] || null;
        ordersByCartId.set(cartId, {
          cart_id: cartId,
          cart: cart
            ? {
                id: cart.id,
                currency_code: cart.currency_code,
                metadata: cart.metadata,
                created_at: cart.created_at,
                completed_at: cart.completed_at,
              }
            : null,
          customer,
          items: [],
          order,
          created_at: lineItem?.created_at ?? null,
          total_price: 0,
        });
      }

      const group = ordersByCartId.get(cartId)!;

      group.items.push({
        design: design
          ? { id: design.id, name: design.name, status: design.status, estimated_cost: design.estimated_cost }
          : { id: linkRow.design_id, name: "Unknown", status: "" },
        line_item_id: linkRow.line_item_id,
        price: lineItem?.unit_price ?? 0,
        metadata: lineItem?.metadata ?? null,
        added_at: lineItem?.created_at ?? null,
      });

      group.total_price += lineItem?.unit_price ?? 0;

      // Use the first available order or customer across items in the group
      if (!group.order && order) group.order = order;
      if (!group.customer && customer) group.customer = customer;
    }

    // 6. Convert to array, sort newest first, then paginate
    const allOrders = Array.from(ordersByCartId.values());
    allOrders.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    const total = allOrders.length;
    const rows = allOrders.slice(offset, offset + limit);

    res.status(200).json({ design_orders: rows, count: total, offset, limit });
  } catch (error) {
    console.error("[Admin] Error fetching design orders:", error);
    res.status(500).json({
      message: "Failed to fetch design orders",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
