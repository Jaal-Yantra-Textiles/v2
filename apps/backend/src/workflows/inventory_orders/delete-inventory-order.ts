import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { RemoteQueryFunction } from "@medusajs/types";
import type { Link } from "@medusajs/modules-sdk";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import InventoryOrderService from "../../modules/inventory_orders/service";
import { InferTypeOf } from "@medusajs/framework/types"
import { default as InventoryOrderModel } from "../../modules/inventory_orders/models/order";
import { assertDeletable } from "./lib/delete-helpers";
export type InventoryOrder = InferTypeOf<typeof InventoryOrderModel>;

// --- Interfaces for API Input ---
export interface DeleteInventoryOrderInput {
  id: string;
}

// --- Inventory Orders Delete Steps ---

export const fetchInventoryOrderStep = createStep(
  "fetch-inventory-order-step",
  async (input: DeleteInventoryOrderInput, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>;
    
    // Fetch the inventory order with its order lines and stock location
    const { data: inventoryOrder } = await query.graph({
      entity: "inventory_orders",
      filters: {
        id: input.id
      },
      fields: ["id", "status", "orderlines.*", "orderlines.inventory_items.*", "stock_locations.*"]
    });

    // #778 H11 — query.graph returns an array (truthy even when empty), so the
    // old `if (!inventoryOrder)` check never fired and a missing order fell
    // through. Check the first element instead.
    if (!inventoryOrder || inventoryOrder.length === 0 || !inventoryOrder[0]) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND,
        `Inventory order with id ${input.id} not found`
      );
    }

    return new StepResponse(inventoryOrder as  unknown as InventoryOrder);
  }
);

/**
 * Cascade-delete EVERY link the inventory order (and each of its lines)
 * participates in (#778 H11). The old steps only dismissed the inventory-item
 * and stock-location links, orphaning the partner, task, internal-payment,
 * feedback, inbound-email and unified-order links (and the per-line fulfillment
 * links). `remoteLink.delete({ [MODULE]: { <fk>: id } })` removes all link rows
 * for that record across every registered link definition, so nothing is left
 * dangling. Best-effort per record so one failing link table doesn't abort the
 * whole delete.
 */
export const dismissInventoryOrderLinksStep = createStep(
  "dismiss-inventory-order-links-step",
  async (input: {
    inventoryOrder: any;
  }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    const order = input.inventoryOrder;

    // Order-level links (partner / task / internal_payments / feedback /
    // stock_location / inbound_email / unified core order).
    try {
      await remoteLink.delete({
        [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
      });
    } catch {
      /* best-effort */
    }

    // Per-line links (inventory_item + line_fulfillment).
    for (const orderLine of order.orderlines || []) {
      if (!orderLine?.id) continue;
      try {
        await remoteLink.delete({
          [ORDER_INVENTORY_MODULE]: { inventory_order_line_id: orderLine.id },
        });
      } catch {
        /* best-effort */
      }
    }

    return new StepResponse(true);
  }
);

export const deleteInventoryOrderStep = createStep(
  "delete-inventory-order-step",
  async (input: { 
    inventoryOrder: any;
  }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    // Soft delete all order lines first
    if (input.inventoryOrder.orderlines && input.inventoryOrder.orderlines.length > 0) {
      for (const orderLine of input.inventoryOrder.orderlines) {
        await inventoryOrderService.softDeleteOrderLines(orderLine.id);
      }
    }
    
    // Soft delete the inventory order
    await inventoryOrderService.softDeleteInventoryOrders(input.inventoryOrder.id);
    
    return new StepResponse(true);
  }
);

export const deleteInventoryOrderWorkflow = createWorkflow(
  {
    name: "delete-inventory-order-workflow",
    store: true,
  },
  (input: DeleteInventoryOrderInput) => {
      // Step 1: Fetch the inventory order with its relations
      const inventoryOrder = fetchInventoryOrderStep(input);
      
      // Step 2: Transform the data + guard the delete transition (#778 H11):
      // refuse to hard-delete an order that has posted stock / active
      // fulfillments (Shipped / Delivered / Partial) — it must be cancelled
      // first so the stock is reversed.
      const transformedData = transform(
        { inventoryOrder },
        ({ inventoryOrder }) => {
          const orderData = inventoryOrder[0]

          if (!orderData) {
            throw new Error("No inventory order data found");
          }

          assertDeletable((orderData as any).status);

          return {
            inventoryOrder: orderData
          };
        }
      );

      // Step 3: Cascade-delete ALL links the order + its lines participate in
      dismissInventoryOrderLinksStep(transformedData);

      // Step 4: Delete the inventory order and its order lines
      deleteInventoryOrderStep(transformedData);
      
      return new WorkflowResponse(true);
  }
);