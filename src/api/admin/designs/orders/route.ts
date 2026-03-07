import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import type { IOrderModuleService } from "@medusajs/types";
import designLineItemLink from "../../../../links/design-line-item-link";
import designCustomerLink from "../../../../links/design-customer-link";

/**
 * GET /admin/designs/orders
 *
 * Returns all designs that have been added to carts (as custom line items),
 * joined with their order details if the cart was completed into an order.
 *
 * Flow:
 *   design → [designLineItemLink] → CartLineItem (has cart_id)
 *   cart_id → Order (order.cart_id matches)
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

    // 2. Fetch design details + linked customer in parallel
    const [designsResult, customerLinksResult] = await Promise.all([
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

    // 4. Find orders linked to those carts via order.cart_id
    const cartIds = [
      ...new Set(
        cartLineItems.map((li: any) => li.cart_id).filter(Boolean)
      ),
    ] as string[];

    const ordersByCartId: Record<string, any> = {};
    if (cartIds.length > 0) {
      const orderService = req.scope.resolve(Modules.ORDER) as IOrderModuleService;
      const orders = await orderService.listOrders(
        { cart_id: cartIds } as any,
        {
          select: [
            "id",
            "display_id",
            "status",
            "payment_status",
            "fulfillment_status",
            "total",
            "currency_code",
            "cart_id",
            "created_at",
            "canceled_at",
          ] as any,
        }
      );
      for (const o of orders as any[]) {
        if (o.cart_id) ordersByCartId[o.cart_id] = o;
      }
    }

    // 5. Build combined rows — one row per design → line item link
    const allRows = (linkRows as any[]).map((linkRow) => {
      const design = designById[linkRow.design_id];
      const lineItem = lineItemById[linkRow.line_item_id];
      const customer = customerByDesignId[linkRow.design_id] || null;
      const order = lineItem ? ordersByCartId[lineItem.cart_id] || null : null;

      return {
        design: design
          ? { id: design.id, name: design.name, status: design.status }
          : { id: linkRow.design_id, name: "Unknown", status: "" },
        customer: customer
          ? {
              id: customer.id,
              email: customer.email,
              first_name: customer.first_name,
              last_name: customer.last_name,
            }
          : null,
        line_item_id: linkRow.line_item_id,
        cart_id: lineItem?.cart_id ?? null,
        price: lineItem?.unit_price ?? 0,
        added_at: lineItem?.created_at ?? null,
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
              canceled_at: order.canceled_at,
            }
          : null,
      };
    });

    // 6. Sort newest first, then paginate
    allRows.sort((a, b) => {
      const ta = a.added_at ? new Date(a.added_at).getTime() : 0;
      const tb = b.added_at ? new Date(b.added_at).getTime() : 0;
      return tb - ta;
    });

    const total = allRows.length;
    const rows = allRows.slice(offset, offset + limit);

    res.status(200).json({ design_orders: rows, count: total, offset, limit });
  } catch (error) {
    console.error("[Admin] Error fetching design orders:", error);
    res.status(500).json({
      message: "Failed to fetch design orders",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
