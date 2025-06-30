import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import InventoryOrderService from "../../modules/inventory_orders/service";
import { InferTypeOf } from "@medusajs/framework/types"
import { default as InventoryOrderModel } from "../../modules/inventory_orders/models/order";
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
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    
    // Fetch the inventory order with its order lines and stock location
    const { data: inventoryOrder } = await query.graph({
      entity: "inventory_orders",
      filters: {
        id: input.id
      },
      fields: ["id", "orderlines.*", "orderlines.inventory_items.*", "stock_locations.*"]
    });

    if (!inventoryOrder) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, 
        `Inventory order with id ${input.id} not found`
      );
    }

    return new StepResponse(inventoryOrder as  unknown as InventoryOrder);
  }
);

export const dismissInventoryItemLinksStep = createStep(
  "dismiss-inventory-item-links-step",
  async (input: { 
    inventoryOrder: any;
  }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    // Only proceed if there are order lines with inventory items
    if (!input.inventoryOrder.orderlines || input.inventoryOrder.orderlines.length === 0) {
      return new StepResponse([]);
    }

    // Dismiss links between order lines and inventory items
    const dismissPromises = input.inventoryOrder.orderlines.map(async (orderLine: any) => {
      if (orderLine.inventory_items && orderLine.inventory_items.length > 0) {
        await remoteLink.dismiss({
          [ORDER_INVENTORY_MODULE]: {
            inventory_order_line_id: orderLine.id,
          },
          [Modules.INVENTORY]: {
            inventory_item_id: orderLine.inventory_items[0].id,
          }
        });
      }
    });

    await Promise.all(dismissPromises);
    return new StepResponse();
  }
);

export const dismissStockLocationLinkStep = createStep(
  "dismiss-stock-location-link-step",
  async (input: { 
    inventoryOrder: any;
  }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    // Only proceed if there's a stock location
    if (!input.inventoryOrder.stock_locations || input.inventoryOrder.stock_locations.length === 0) {
      return new StepResponse(true);
    }

    // Dismiss link between inventory order and stock location
    await remoteLink.dismiss({
      [ORDER_INVENTORY_MODULE]: {
        inventory_orders_id: input.inventoryOrder.id,
      },
      [Modules.STOCK_LOCATION]: {
        stock_location_id: input.inventoryOrder.stock_locations[0].id,
      }
    });

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
      
      // Step 2: Transform the data for the next steps
      const transformedData = transform(
        { inventoryOrder },
        ({ inventoryOrder }) => {
          const orderData = inventoryOrder[0]
          
          if (!orderData) {
            throw new Error("No inventory order data found");
          }
          
          return {
            inventoryOrder: orderData
          };
        }
      );
      
      // Step 3: Dismiss links between order lines and inventory items
      dismissInventoryItemLinksStep(transformedData);
      
      // Step 4: Dismiss link between inventory order and stock location
      dismissStockLocationLinkStep(transformedData);
      
      // Step 5: Delete the inventory order and its order lines
      deleteInventoryOrderStep(transformedData);
      
      return new WorkflowResponse(true);
  }
);