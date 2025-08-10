import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import InventoryOrdersStockLocationsLink from "../../links/inventory-orders-stock-locations";

export type ListSingleInventoryOrderStepInput = {
  id: string;
  fields: string[];
};

export const listSingleInventoryOrderStep = createStep(
  "list-single-inventory-order-step",
  async (input: ListSingleInventoryOrderStepInput, { container }) => {
    // Always include '*' for full fetch if not specified
    if (!input.fields.includes("*")) {
      input.fields.push("*");
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: input.fields || ["*", "partner.*"],
      filters: {
        id: input.id,
      },
    });
    if (!orders[0]) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory Order with id ${input.id} was not found`
      );
    }
    const order = orders[0];

    console.log("Order:", JSON.stringify(order, null, 2));

    // Fetch stock location links and merge from/to locations
    const { data: links } = await query.graph({
      entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
      fields: [
        "from_location",
        "to_location",
        "inventory_orders.*",
        "stock_location.*",
      ],
      filters: {
        inventory_orders_id: input.id,
      },
    });

    console.log("Links:", JSON.stringify(links, null, 2));

    // Build a map from the already-fetched order.stock_locations for richer objects
    const stockLocById: Record<string, any> = (order?.stock_locations || []).reduce(
      (acc: Record<string, any>, sl: any) => {
        if (sl?.id) acc[sl.id] = sl;
        return acc;
      },
      {}
    );

    let from_stock_location: any = null;
    let to_stock_location: any = null;
    (links || []).forEach((link: any) => {
      if (link?.from_location) {
        const candidate = stockLocById[link?.stock_location_id] || link?.stock_location;
        from_stock_location = candidate || from_stock_location;
      }
      if (link?.to_location) {
        const candidate = stockLocById[link?.stock_location_id] || link?.stock_location;
        to_stock_location = candidate || to_stock_location;
      }
    });

    const augmented = {
      ...order,
      from_stock_location,
      to_stock_location,
    };

    return new StepResponse(augmented as any, order?.id);
  },
);

export type ListSingleInventoryOrderWorkflowInput = ListSingleInventoryOrderStepInput;

export const listSingleInventoryOrderWorkflow = createWorkflow(
  {
    name: "list-single-inventory-order",
    store: true,
  },
  (input: ListSingleInventoryOrderWorkflowInput) => {
    const result = listSingleInventoryOrderStep(input);
    return new WorkflowResponse(result);
  },
);

export default listSingleInventoryOrderWorkflow;
