import {
  MedusaService,
  MedusaError,
  InjectTransactionManager,
  MedusaContext,
} from "@medusajs/framework/utils";

import InventoryOrder from "./models/order";
import OrderLine from "./models/orderline";
import InventoryOrderActivity from "./models/inventory-order-activity";
import type { InventoryOrderInputStatus } from "./constants";

import { InferTypeOf, Context } from "@medusajs/framework/types"
import {
  buildOrderLinePayloads,
  buildInventoryLineLinkPairs,
} from "./lib/create-helpers";
export type OrderLinesResponse = InferTypeOf<typeof OrderLine>[]

interface CreateInventoryOrder {
  quantity: number;
  total_price: number;
  currency_code?: string;
  status: InventoryOrderInputStatus;
  expected_delivery_date: Date | undefined;
  order_date: Date | undefined;
  metadata?: Record<string, unknown>;
  shipping_address: Record<string, unknown>;
  is_sample: boolean;
}

interface CreateOrderLine {
  inventory_id: string;
  quantity: number;
  price: number;
  metadata?: Record<string, unknown>;
}

class InventoryOrderService extends MedusaService({
  InventoryOrder,
  OrderLine,
  InventoryOrderActivity,
}) {
  constructor() {
    super(...arguments)
  }

  async listInventoryOrderLines(...args) {
    return this.listOrderLines(...args)
  }

  async listAndCountInventoryOrderLines(...args) {
    return this.listAndCountOrderLines(...args)
  }

  
  /**
   * Create an inventory order together with its lines, atomically (#778 C3).
   *
   * `@InjectTransactionManager` wraps the whole method in a single module
   * transaction; the shared context is threaded into the auto-generated
   * `createInventoryOrders` / `createOrderLines` calls so they enlist in it.
   * Either the order and ALL its lines commit, or nothing does — replacing the
   * previous behaviour that created the order, then created lines in a loop that
   * swallowed per-line failures and returned a partial `orderLines` (which the
   * linking step then zipped against the full input by index, mis-linking the
   * wrong inventory item to the wrong line).
   *
   * Returns the line ↔ inventory-item pairing computed at creation time so the
   * downstream link step pairs explicitly rather than positionally.
   */
  @InjectTransactionManager()
  async createInvWithLines(
    inventory_order: CreateInventoryOrder,
    order_lines: CreateOrderLine[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    // Input validation (runs inside the transaction; nothing is created yet, so
    // a throw here simply aborts before any write).
    if (!Array.isArray(order_lines) || order_lines.length === 0) {
      throw new Error("At least one order line is required.");
    }
    for (const [i, line] of order_lines.entries()) {
      if (inventory_order.is_sample) {
        // For samples, quantity and price can be zero, but not negative.
        if (typeof line.quantity !== 'number' || line.quantity < 0) {
          throw new Error(`Order line at index ${i} has invalid quantity: cannot be negative for a sample.`);
        }
        if (typeof line.price !== 'number' || line.price < 0) {
          throw new Error(`Order line at index ${i} has invalid price: cannot be negative for a sample.`);
        }
      } else {
        // For non-samples, quantity must be positive, price must be non-negative.
        if (typeof line.quantity !== 'number' || line.quantity <= 0) {
          throw new Error(`Order line at index ${i} has invalid quantity: must be positive.`);
        }
        if (typeof line.price !== 'number' || line.price < 0) {
          throw new Error(`Order line at index ${i} has invalid price: cannot be negative.`);
        }
      }
    }

    let order: InferTypeOf<typeof InventoryOrder>;
    let orderLines: OrderLinesResponse;
    try {
      // Both writes share `sharedContext` → same transaction. A failure on the
      // lines rolls the order back too (rethrow below keeps us inside the
      // transaction's failure path).
      order = (await this.createInventoryOrders(
        { ...inventory_order },
        sharedContext
      )) as InferTypeOf<typeof InventoryOrder>;

      orderLines = (await this.createOrderLines(
        buildOrderLinePayloads(order_lines, order.id),
        sharedContext
      )) as OrderLinesResponse;
    } catch (err: any) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to create inventory order with lines: ${err?.message || String(err)}`
      );
    }

    const lineItemPairs = buildInventoryLineLinkPairs(orderLines, order_lines);

    return { order, orderLines, lineItemPairs };
  }
} 

export default InventoryOrderService;
