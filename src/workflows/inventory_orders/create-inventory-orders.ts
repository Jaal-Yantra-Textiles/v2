import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import { LinkDefinition } from "@medusajs/framework/types";
import { transform } from "@medusajs/framework/workflows-sdk";
import { InferTypeOf } from "@medusajs/framework/types"
import InventoryOrder from "../../modules/inventory_orders/models/order";
import InventoryOrderService from "../../modules/inventory_orders/service";
import type { Link } from "@medusajs/modules-sdk";
import type { IInventoryService } from "@medusajs/types";
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
  stock_location_id: string;
  from_stock_location_id?: string;
  metadata?: Record<string, unknown>;
  order_lines: InventoryOrderLineInput[];
  is_sample: boolean;
}

// --- Inventory Orders Steps ---

export const validateInventoryStep = createStep(
  "validate-inventory-step",
  async (input: CreateInventoryOrderInput, { container }) => {
    const inventoryService = container.resolve(Modules.INVENTORY) as IInventoryService;
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

    // Compute defaults for fields that may be undefined when called from a visual flow
    const totalFromLines = orderLinesForService.reduce(
      (sum, l) => sum + (Number(l.price) || 0),
      0
    )
    const quantityFromLines = orderLinesForService.reduce(
      (sum, l) => sum + (Number(l.quantity) || 0),
      0
    )

    const processedOrderData = {
      ...orderData,
      // Fall back to computed values if top-level quantity/total_price are missing
      quantity: orderData.quantity != null ? Number(orderData.quantity) : quantityFromLines,
      total_price: orderData.total_price != null ? Number(orderData.total_price) : totalFromLines,
      // Accept metadata as either an object or a JSON string
      metadata: typeof orderData.metadata === "string"
        ? (() => { try { return JSON.parse(orderData.metadata as unknown as string) } catch { return {} } })()
        : (orderData.metadata ?? null),
    }

    const created = await inventoryOrderService.createInvWithLines(processedOrderData, orderLinesForService);
    return new StepResponse(created);
  }
);



export const linkInventoryItemsWithLinesStep = createStep(
  "link-inventory-items-with-lines-step",
  async (
    input: { order_id: string; orderline_ids: string[]; inventory_item_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
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
    await remoteLink.create(links);
    return new StepResponse(links);
  }
);

export const linkInventoryOrderWithStockLocation = createStep(
  "link-inventory-order-with-stock-location",
  async (input: { order_id: string; stock_location_id: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    const links: LinkDefinition[] = [];
    links.push({
      [ORDER_INVENTORY_MODULE]: {
        inventory_orders_id: input.order_id,
      },
      [Modules.STOCK_LOCATION]: {
        stock_location_id: input.stock_location_id,
        
      },
      data: {
        order_id: input.order_id,
        stock_location_id: input.stock_location_id,
        // toLocation link
        from_location: false,
        to_location: true,
      },
    });
    await remoteLink.create(links);
    return new StepResponse(links);
  }
)


export const linkInventoryOrderWithFromStockLocation = createStep(
  "link-inventory-order-with-from-stock-location",
  async (
    input: { order_id: string; from_stock_location_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    const links: LinkDefinition[] = [];
    links.push({
      [ORDER_INVENTORY_MODULE]: {
        inventory_orders_id: input.order_id,
      },
      [Modules.STOCK_LOCATION]: {
        stock_location_id: input.from_stock_location_id,
      },
      data: {
        order_id: input.order_id,
        stock_location_id: input.from_stock_location_id,
        // fromLocation link
        from_location: true,
        to_location: false,
      },
    });
    await remoteLink.create(links);
    return new StepResponse(links);
  }
)





export const createInventoryOrderWorkflow = createWorkflow(
  {
    name: "create-inventory-order-workflow",
    store: true,
  },
  (input: CreateInventoryOrderInput) => {
    // Step 1: Create inventory order and lines
    // (validateInventoryStep removed — it ran independently of this step so Medusa
    //  could execute the transform before validation completed, causing crashes.
    //  Invalid inventory items will be caught by linkInventoryItemsWithLinesStep.)
    const created = createInventoryOrderWithLinesStep(input);

    // Step 2: Use transform to shape input for linking step
    const linkInput = transform(
      { created, input },
      ({ created, input }) => {
        if (!created?.order) {
          throw new Error(
            "createInventoryOrderWithLinesStep did not return an order. " +
            "Check that all order_lines have valid inventory_item_id values and positive quantities."
          )
        }
        return {
          order_id: created.order.id,
          orderline_ids: created.orderLines.map((ol: any) => ol.id),
          inventory_item_ids: input.order_lines.map((ol: any) => ol.inventory_item_id),
          order: created.order,
          orderLines: created.orderLines,
        }
      }
    );
    const links = linkInventoryItemsWithLinesStep(linkInput);

    // Determine the to-location id from alias or stock_location_id
    const toLocationId = transform({ input }, ({ input }) => (
      (input as any).to_stock_location_id || input.stock_location_id
    ));

    // Always link TO location (required by validator)
    linkInventoryOrderWithStockLocation({
      order_id: linkInput.order_id,
      stock_location_id: toLocationId as any,
    });

    // Conditionally link FROM location using when()
    when(input, (i) => Boolean(i.from_stock_location_id)).then(() => {
      linkInventoryOrderWithFromStockLocation({
        order_id: linkInput.order_id,
        from_stock_location_id: input.from_stock_location_id as string,
      });
    });

    // Step 3: Use transform to shape the final response
    const response = transform(
      { links, linkInput },
      ({ links, linkInput }) => ({
        order: linkInput.order,
        orderLines: linkInput.orderLines,
        links,
      })
    );

    return new WorkflowResponse(response);
  }
);

