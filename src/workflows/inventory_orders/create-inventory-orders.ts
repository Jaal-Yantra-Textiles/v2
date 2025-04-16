import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import { LinkDefinition } from "@medusajs/framework/types";
import { transform } from "@medusajs/framework/workflows-sdk";
import { InferTypeOf } from "@medusajs/framework/types"
import InventoryOrder from "../../modules/inventory_orders/models/order";
import InventoryOrderService from "../../modules/inventory_orders/service";
export type InventoryOrder = InferTypeOf<typeof InventoryOrder>;

// --- Interfaces for API Input ---
export interface InventoryOrderLineInput {
  inventory_item_id: string;
  quantity: number;
  price: number;
  metadata?: Record<string, unknown>;
}

export interface CreateInventoryOrderInput {
  quantity: number;
  total_price: number;
  status: 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
  expected_delivery_date: Date | undefined;
  order_date: Date | undefined;
  shipping_address: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  order_lines: InventoryOrderLineInput[];
}

// --- Empty Steps ---

export const validateInventoryStep = createStep(
  "validate-inventory-step",
  async (input: CreateInventoryOrderInput, { container }) => {
    console.log(input)
    const inventoryService = container.resolve(Modules.INVENTORY);
    const missingItems: string[] = [];
    for (const line of input.order_lines) {
      try {
        await inventoryService.retrieveInventoryItem(line.inventory_item_id);
      } catch (err) {
        // If not found, Medusa's retrieveInventoryItem should throw
        missingItems.push(line.inventory_item_id);
      }
    }
    if (missingItems.length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory items not found: ${missingItems.join(", ")}`
      );
    }
    return new StepResponse(true);
  }
);

export const createInventoryOrderWithLinesStep = createStep(
  "create-inventory-order-with-lines-step",
  async (input: CreateInventoryOrderInput, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);

    // Prepare order and order lines for the service
    const { order_lines, ...orderData } = input;
    
    // Map to service's expected order line shape
    const orderLinesForService = order_lines.map(line => ({
      inventory_id: line.inventory_item_id,
      quantity: line.quantity,
      price: line.price,
      metadata: line.metadata
    }));

    const created = await inventoryOrderService.createInvWithLines(orderData, orderLinesForService);
    return new StepResponse(created);
  }
);



export const linkInventoryItemsWithLinesStep = createStep(
  "link-inventory-items-with-lines-step",
  async (
    input: { order_id: string; orderline_ids: string[]; inventory_item_ids: string[] },
    { container }
  ) => {
    console.log(input)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    const links: LinkDefinition[] = input.orderline_ids.map((orderlineId, idx) => ({
      [ORDER_INVENTORY_MODULE]: {
        inventory_order_line_id: orderlineId,
      },
      [Modules.INVENTORY]: {
        inventory_item_id: input.inventory_item_ids[idx],
      },
      data: {
        //order_id: input.order_id,
        order_line_id: orderlineId,
        inventory_item_id: input.inventory_item_ids[idx],
      },
    }));
    console.log(links)
    await remoteLink.create(links);
    return new StepResponse(links);
  }
);





export const createInventoryOrderWorkflow = createWorkflow(
  "create-inventory-order-workflow",
  (input: CreateInventoryOrderInput) => {
    console.log(input)
    // Step 1: Validate inventory items
    const validated = validateInventoryStep(input);

    // Step 2: Create inventory order and lines
    const created = createInventoryOrderWithLinesStep(input);

    // Step 3: Use transform to shape input for linking step
    const linkInput = transform(
      { created, input },
      ({ created, input }) => ({
        order_id: created.order.id,
        orderline_ids: created.orderLines.map((ol: any) => ol.id),
        inventory_item_ids: input.order_lines.map((ol: any) => ol.inventory_item_id),
        order: created.order,
        orderLines: created.orderLines,
      })
    );
    const links = linkInventoryItemsWithLinesStep(linkInput);

    // Step 4: Use transform to shape the final response
    const response = transform(
      { links, created },
      ({ links, created }) => ({
        order: created.order,
        orderLines: created.orderLines,
        links,
      })
    );

    return new WorkflowResponse(response);
  }
);

