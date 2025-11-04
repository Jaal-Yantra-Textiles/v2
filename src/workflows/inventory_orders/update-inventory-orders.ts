import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import InventoryOrderService from "../../modules/inventory_orders/service";


// Types
export type UpdateInventoryOrderLineInput = {
  id?: string; // If present, update; if not, create
  inventory_item_id: string;
  quantity: number;
  price: number;
  remove?: boolean; // If true, remove this orderline
};

export type UpdateInventoryOrderInput = {
  id: string;
  data: Partial<{
    status: string;
    expected_delivery_date: Date;
    order_date: Date;
    total_price: number;
    quantity: number;
    shipping_address: any;
    // ...other updatable fields
  }>;
  order_lines: UpdateInventoryOrderLineInput[];
};

// Step 1: Fetch original order and orderlines for compensation
export const fetchOriginalOrderStep = createStep(
  "fetch-original-inventory-order-step",
  async (input: { id: string }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const originalOrder = await inventoryOrderService.retrieveInventoryOrder(input.id, { relations: ["orderlines"] });
    // Only allow update if status is 'Pending' or 'Processing'
    if (!["Pending", "Processing"].includes(originalOrder.status)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Order can only be updated if status is 'Pending' or 'Processing'."
      );
    }
    return new StepResponse(originalOrder, originalOrder); // Save for compensation
  },
  // Compensation: no-op (fetch only)
  async () => {}
);

// Step 2: Update inventory order fields
export const updateInventoryOrderStep = createStep(
  "update-inventory-order-step",
  async (input: { id: string; data: any }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const updatedOrder = await inventoryOrderService.updateInventoryOrders({
      selector: {
        id: input.id
      }, 
      data: {
        ...input.data
      }
    });
    return new StepResponse(updatedOrder, null);
  },
  // Compensation: restore original order fields
  async (originalOrder: any, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    await inventoryOrderService.updateInventoryOrders({
      selector: {
        id: originalOrder.id
      },
      data: originalOrder
    });
  }
);

// Step 3: Update orderlines (add, update, remove, relink)
export const updateOrderLinesStep = createStep(
  "update-inventory-orderlines-step",
  async (input: { order_id: string; order_lines: UpdateInventoryOrderLineInput[] }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    // Fetch current orderlines
    const currentOrder = await inventoryOrderService.retrieveInventoryOrder(input.order_id, { relations: ["orderlines"] });
    const currentOrderlines = currentOrder.orderlines || [];
    const originalOrderlines = [...currentOrderlines];
    // Remove orderlines marked for removal
    for (const line of input.order_lines.filter(l => l.remove && l.id)) {
      // Soft delete orderline
      await inventoryOrderService.softDeleteOrderLines(line.id!);
      // Dismiss link between orderline and inventory_item
      if (line.inventory_item_id) {
        await remoteLink.dismiss({
          [ORDER_INVENTORY_MODULE]: {
            inventory_order_line_id: line.id!
          },
          [Modules.INVENTORY]: {
            inventory_item_id: line.inventory_item_id
          }
        });
      }
    }
    // Update or create orderlines and manage links
    for (const line of input.order_lines.filter(l => !l.remove)) {
      if (line.id) {
        // Update orderline fields
        await inventoryOrderService.updateOrderLines({
          selector: { id: line.id },
          data: {
            quantity: line.quantity,
            price: line.price,
          }
        });
        // If inventory_item_id changed, handle link update (not implemented here, but can be compared with currentOrderlines)
      } else {
        // Create orderline
        const created = await inventoryOrderService.createOrderLines({
          inventory_orders_id: input.order_id,
          quantity: line.quantity,
          price: line.price,
        });
        // Create link to inventory item
        if (line.inventory_item_id) {
          await remoteLink.create({
            [ORDER_INVENTORY_MODULE]: {
              inventory_order_line_id: created.id
            },
            [Modules.INVENTORY]: {
              inventory_item_id: line.inventory_item_id
            },
            data: {
              order_line_id: created.id,
              inventory_item_id: line.inventory_item_id
            }
          });
        }
      }
    }
    // Return new state and save original for compensation
    const updatedOrder = await inventoryOrderService.retrieveInventoryOrder(input.order_id, { relations: ["orderlines"] });
    // Save originalOrderlines and order_id for compensation
    return new StepResponse(updatedOrder, { originalOrderlines, order_id: input.order_id });
  },
  // Compensation: restore all original orderlines (delete new, restore old and relink)
  async (compensationData: { originalOrderlines: any[]; order_id: string }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    // Remove all current orderlines
    const currentOrder = await inventoryOrderService.retrieveInventoryOrder(compensationData.order_id, { relations: ["orderlines"] });
    for (const line of currentOrder.orderlines || []) {
      await inventoryOrderService.softDeleteOrderLines(line.id);
      // Remove link if exists (need inventory_item_id, which may not be available for deleted lines)
      // This is a best-effort cleanup
    }
    // Restore original orderlines and links
    for (const orig of compensationData.originalOrderlines) {
      const restored = await inventoryOrderService.createOrderLines({
        inventory_orders_id: compensationData.order_id,
        quantity: orig.quantity,
        price: orig.price,
      });
      if (orig.inventory_item_id) {
        await remoteLink.create({
          [ORDER_INVENTORY_MODULE]: {
            inventory_order_line_id: restored.id
          },
          [Modules.INVENTORY]: {
            inventory_item_id: orig.inventory_item_id
          },
          data: {
            order_line_id: restored.id,
            inventory_item_id: orig.inventory_item_id
          }
        });
      }
    }
  }
);

export const updateInventoryOrderWorkflow = createWorkflow(
  { 
    name: "update-inventory-order-workflow",
    store: true
  },
  (input: UpdateInventoryOrderInput) => {
    const original = fetchOriginalOrderStep({ id: input.id });
    const updatedOrder = updateInventoryOrderStep({ id: input.id, data: input.data });
    const updatedOrderlines = updateOrderLinesStep({ order_id: input.id, order_lines: input.order_lines });
    return new WorkflowResponse({ order: updatedOrder, orderlines: updatedOrderlines });
  },
);

export default updateInventoryOrderWorkflow;
