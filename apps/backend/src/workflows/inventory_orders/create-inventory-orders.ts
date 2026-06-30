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
import { dualWriteUnifiedOrderStep } from "./dual-write-unified-order";
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
  status: 'Pending' | 'Processing' | 'Ready for Delivery' | 'Shipped' | 'Delivered' | 'Cancelled';
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
    // Compensation data so the SAGA can roll the order + lines back if a later
    // (cross-module) step fails — the module-link writes are NOT part of the
    // create transaction, so this is how we stay consistent across that boundary
    // (#778 C3).
    return new StepResponse(created, {
      orderId: created?.order?.id,
      lineIds: (created?.orderLines ?? []).map((l: any) => l.id),
    });
  },
  async (compensationData, { container }) => {
    if (!compensationData?.orderId) return;
    const service = container.resolve(ORDER_INVENTORY_MODULE) as InventoryOrderService;
    try {
      if (compensationData.lineIds?.length) {
        await (service as any).deleteOrderLines(compensationData.lineIds);
      }
      await service.deleteInventoryOrders(compensationData.orderId);
    } catch {
      /* best-effort rollback */
    }
  }
);



export const linkInventoryItemsWithLinesStep = createStep(
  "link-inventory-items-with-lines-step",
  async (
    input: { order_id: string; line_pairs: { order_line_id: string; inventory_item_id: string }[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    // Link each line to its inventory item by the explicit pairing computed at
    // creation time (#778 C3) — never by re-zipping two arrays by index.
    const links: LinkDefinition[] = (input.line_pairs ?? []).map(({ order_line_id, inventory_item_id }) => ({
      [ORDER_INVENTORY_MODULE]: {
        inventory_order_line_id: order_line_id,
      },
      [Modules.INVENTORY]: {
        inventory_item_id,
      },
      data: {
        order_line_id,
        inventory_item_id,
      },
    }));
    await remoteLink.create(links);
    return new StepResponse(links, links);
  },
  async (links, { container }) => {
    if (!links?.length) return;
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    try {
      await remoteLink.dismiss(links as any);
    } catch {
      /* best-effort link cleanup */
    }
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
          // Explicit line→item pairing from the create step (#778 C3) — not a
          // positional zip of separately-derived id arrays.
          line_pairs: created.lineItemPairs ?? [],
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

    // #342 T2: best-effort projection onto a core order (kind=inventory,
    // discriminated by the order↔inventory_order link since Chunk 6). The step
    // swallows its own errors — a dual-write failure must never fail the legacy
    // create.
    dualWriteUnifiedOrderStep({
      order: linkInput.order,
      orderLines: linkInput.orderLines,
      input,
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

