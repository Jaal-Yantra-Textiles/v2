import { MedusaService } from "@medusajs/framework/utils";

import InventoryOrder from "./models/order";
import OrderLine from "./models/orderline";

import { InferTypeOf } from "@medusajs/framework/types"
export type OrderLinesResponse = InferTypeOf<typeof OrderLine>[]

interface CreateInventoryOrder {
  quantity: number;
  total_price: number;
  status: 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
  expected_delivery_date: Date | undefined;
  order_date: Date | undefined;
  metadata: Record<string, unknown> | null;
  shipping_address: Record<string, unknown> | null;
}

interface CreateOrderLine {
  inventory_id: string;
  quantity: number;
  price: number;
  metadata: Record<string, unknown> | null;
}

class InventoryOrderService extends MedusaService({
  InventoryOrder,
  OrderLine,
}) {
  constructor() {
    super(...arguments)
  }

  
  async createInvWithLines(inventory_order: CreateInventoryOrder, order_lines: CreateOrderLine[]) {
    // Input validation
    if (!Array.isArray(order_lines) || order_lines.length === 0) {
      throw new Error("At least one order line is required.");
    }
    for (const [i, line] of order_lines.entries()) {
      if (typeof line.quantity !== 'number' || line.quantity <= 0) {
        throw new Error(`Order line at index ${i} has invalid quantity: must be positive.`);
      }
      if (typeof line.price !== 'number' || line.price < 0) {
        throw new Error(`Order line at index ${i} has invalid price: cannot be negative.`);
      }
    }

    // Create the InventoryOrder
    let order: InferTypeOf<typeof InventoryOrder>;
    try {
      order = await this.createInventoryOrders({ ...inventory_order });
    } catch (err) {
      throw new Error(`Failed to create inventory order: ${err.message}`);
    }

    // Create OrderLines, collecting errors
    const orderLines: OrderLinesResponse = [];
    const errors: { index: number; inventory_id: string; error: string }[] = [];
    for (const [i, order_line] of order_lines.entries()) {
      try {
        const createdLine = await this.createOrderLines({
          ...order_line,
          inventory_orders: order.id
        });
        orderLines.push(createdLine);
      } catch (lineErr) {
        errors.push({
          index: i,
          inventory_id: order_line.inventory_id,
          error: lineErr.message || String(lineErr)
        });
      }
    }

    if (errors.length > 0) {
      return {
        order,
        orderLines,
        errors,
        message: `Some order lines failed to be created. See 'errors' for details.`
      };
    }

    return { order, orderLines };
  }
} 

export default InventoryOrderService;
